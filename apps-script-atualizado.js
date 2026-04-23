// ============================================================
//  Google Apps Script — Cottolengo Escala v2.0
//  ATUALIZADO: Suporte a update, delete e bulkWrite
//  
//  INSTRUÇÕES: Copie TUDO abaixo e cole no editor do
//  Google Apps Script, substituindo o código anterior.
//  Depois faça: Implantar → Nova Implantação → App da Web
//  e copie a nova URL gerada para o app.js do mobile.
// ============================================================

function doGet(e) {
  return handleResponse(e);
}

function doPost(e) {
  return handleResponse(e);
}

// ── API KEY — Altere este valor e use-o no app.js ──
var API_KEY = 'cotolengo_2026_secure_key';

function handleResponse(request) {
  try {
    // ── Autenticação por API Key ──
    var providedKey = request.parameter.apiKey || '';
    if (providedKey !== API_KEY) {
      return createJsonResponse({status: 'error', message: 'Chiave API non valida.'});
    }
    
    var action = request.parameter.action;
    var sheetName = request.parameter.sheetName;
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName(sheetName);
    
    // Auto-criar aba se não existir (facilita setup inicial)
    if (!sheet) {
      sheet = doc.insertSheet(sheetName);
    }
    
    // ── LEITURA ──
    if (action === "read") {
      var data = readData(sheet);
      return createJsonResponse({status: "success", data: data});
    } 
    
    // ── ESCRITA (append uma linha) ──
    if (action === "write") {
      var payloadString = request.postData ? request.postData.contents : request.parameter.payload;
      var dataToInsert = JSON.parse(payloadString);
      writeData(sheet, dataToInsert);
      return createJsonResponse({status: "success", message: "Registro salvo com sucesso."});
    }
    
    // ── ATUALIZAÇÃO (update por chave) ──
    if (action === "update") {
      var payloadString = request.postData ? request.postData.contents : request.parameter.payload;
      var payload = JSON.parse(payloadString);
      var keyCol = payload._keyColumn;
      var keyVal = String(payload._keyValue);
      delete payload._keyColumn;
      delete payload._keyValue;
      updateData(sheet, keyCol, keyVal, payload);
      return createJsonResponse({status: "success", message: "Registro atualizado."});
    }
    
    // ── EXCLUSÃO (delete por chave) ──
    if (action === "delete") {
      var payloadString = request.postData ? request.postData.contents : request.parameter.payload;
      var payload = JSON.parse(payloadString);
      var keyCol = payload._keyColumn;
      var keyVal = String(payload._keyValue);
      deleteData(sheet, keyCol, keyVal);
      return createJsonResponse({status: "success", message: "Registro excluído."});
    }
    
    // ── ESCRITA EM MASSA (limpa filtro + insere múltiplas linhas) ──
    if (action === "bulkWrite") {
      var payloadString = request.postData ? request.postData.contents : request.parameter.payload;
      var payload = JSON.parse(payloadString);
      bulkWriteData(sheet, payload.clearFilter, payload.clearAll, payload.rows);
      return createJsonResponse({status: "success", message: "Dados gravados em massa."});
    }
    
    // ── SETUP DE HEADERS (cria cabeçalhos se a aba estiver vazia) ──
    if (action === "setupHeaders") {
      var payloadString = request.postData ? request.postData.contents : request.parameter.payload;
      var payload = JSON.parse(payloadString);
      setupHeaders(sheet, payload.headers);
      return createJsonResponse({status: "success", message: "Headers configurados."});
    }
    
    throw new Error("Ação não reconhecida. Use action=read, write, update, delete, bulkWrite ou setupHeaders");
  } catch(err) {
    return createJsonResponse({status: "error", message: err.toString()});
  }
}

function createJsonResponse(responseObject) {
  var output = ContentService.createTextOutput(JSON.stringify(responseObject))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── FUNÇÕES DE DADOS ──────────────────────────────────────────

function readData(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  // Planilha completamente vazia (sem nenhuma célula preenchida)
  if (lastRow === 0 || lastCol === 0) return [];
  
  var rows = sheet.getDataRange().getValues();
  if (rows.length === 0) return [];
  
  var headers = rows[0];
  
  // Verifica se os headers são todos vazios (aba recém-criada)
  var hasRealHeaders = headers.some(function(h) { return h !== "" && h !== null && h !== undefined; });
  if (!hasRealHeaders) return [];
  
  // Somente header existe, sem dados
  if (rows.length <= 1) return [];
  
  var dataBuffer = [];
  
  for (var i = 1; i < rows.length; i++) {
    var rowData = rows[i];
    // Pula linhas completamente vazias
    var isEmptyRow = rowData.every(function(c) { return c === "" || c === null || c === undefined; });
    if (isEmptyRow) continue;
    
    var record = {};
    for (var j = 0; j < headers.length; j++) {
      record[headers[j]] = rowData[j];
    }
    dataBuffer.push(record);
  }
  return dataBuffer;
}

function writeData(sheet, dataObject) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers;
  
  // Se a aba está completamente vazia ou com headers todos vazios
  if (lastRow === 0 || lastCol === 0) {
    headers = Object.keys(dataObject);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var rows = sheet.getDataRange().getValues();
    headers = rows[0];
    
    // Headers todos vazios — recriar
    var hasRealHeaders = headers.some(function(h) { return h !== "" && h !== null && h !== undefined; });
    if (!hasRealHeaders) {
      headers = Object.keys(dataObject);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  
  var newRow = [];
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i];
    newRow.push(dataObject[key] !== undefined ? dataObject[key] : "");
  }
  sheet.appendRow(newRow);
}

function updateData(sheet, keyColumn, keyValue, updates) {
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var keyIdx = headers.indexOf(keyColumn);
  if (keyIdx === -1) throw new Error("Coluna chave não encontrada: " + keyColumn);
  
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][keyIdx]) === String(keyValue)) {
      // Batch update: lê a linha inteira, modifica em memória, escreve de volta
      var rowData = rows[i];
      for (var key in updates) {
        var colIdx = headers.indexOf(key);
        if (colIdx !== -1) {
          rowData[colIdx] = updates[key];
        }
      }
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([rowData]);
      return;
    }
  }
  throw new Error("Registro não encontrado: " + keyColumn + "=" + keyValue);
}

function deleteData(sheet, keyColumn, keyValue) {
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var keyIdx = headers.indexOf(keyColumn);
  if (keyIdx === -1) throw new Error("Coluna chave não encontrada: " + keyColumn);
  
  // Itera de baixo para cima para não bagunçar os índices ao deletar
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][keyIdx]) === String(keyValue)) {
      sheet.deleteRow(i + 1);
    }
  }
}

function bulkWriteData(sheet, clearFilter, clearAll, dataRows) {
  // Se clearAll é true, apaga TODAS as linhas de dados (mantém headers)
  if (clearAll) {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  }
  // Se clearFilter é fornecido, deleta linhas que correspondem ao filtro
  // Suporta filtro composto: clearFilter pode ser objeto único OU array de filtros (AND)
  else if (clearFilter) {
    var filters = Array.isArray(clearFilter) ? clearFilter : [clearFilter];
    // Valida que todos os filtros têm column e value
    var validFilters = filters.filter(function(f) { return f && f.column && f.value !== undefined; });
    if (validFilters.length > 0) {
      var rows = sheet.getDataRange().getValues();
      var headers = rows[0];
      var filterIndices = validFilters.map(function(f) {
        return { idx: headers.indexOf(f.column), value: String(f.value) };
      }).filter(function(f) { return f.idx !== -1; });

      if (filterIndices.length > 0) {
        for (var i = rows.length - 1; i >= 1; i--) {
          var matchAll = filterIndices.every(function(f) {
            return String(rows[i][f.idx]) === f.value;
          });
          if (matchAll) {
            sheet.deleteRow(i + 1);
          }
        }
      }
    }
  }
  
  // Insere todas as novas linhas (batch insert para performance)
  if (dataRows && dataRows.length > 0) {
    var currentRows = sheet.getDataRange().getValues();
    var headers = currentRows[0];
    
    // Se não tem headers, cria a partir do primeiro objeto
    if (currentRows.length === 0 || (currentRows.length === 1 && currentRows[0].every(function(c) { return c === ""; }))) {
      headers = Object.keys(dataRows[0]);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    
    // Batch: monta todas as linhas em memória e escreve de uma vez
    var allNewRows = [];
    for (var r = 0; r < dataRows.length; r++) {
      var newRow = [];
      for (var i = 0; i < headers.length; i++) {
        newRow.push(dataRows[r][headers[i]] !== undefined ? dataRows[r][headers[i]] : "");
      }
      allNewRows.push(newRow);
    }
    if (allNewRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, allNewRows.length, headers.length).setValues(allNewRows);
    }
  }
}

function setupHeaders(sheet, headers) {
  var existing = sheet.getDataRange().getValues();
  if (existing.length === 0 || (existing.length === 1 && existing[0].every(function(c) { return c === ""; }))) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}
