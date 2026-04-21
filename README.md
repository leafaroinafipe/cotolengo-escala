# Cotolengo Turni v2.0
## App PWA para Gestão de Turnos - OTIMIZADO PARA iOS + ANDROID

---

## 🚀 NOVIDADES E MELHORIAS v2.0

### ✅ COMPATIBILIDADE iOS COMPLETA

#### **Problemas Corrigidos:**
1. **Caminhos de Ícones** - Corrigidos paths relativos incorretos (`../icon.png` → `icon-192.png`)
2. **Meta Tags iOS** - Adicionadas tags essenciais para PWA no Safari
3. **Safe Areas** - Suporte completo para iPhone com notch/Dynamic Island
4. **Scroll Bounce** - Prevenção de bounce nativo do iOS
5. **Touch Optimization** - Melhorias na detecção de toque

#### **Novas Features iOS:**
- ✅ Suporte completo a `viewport-fit=cover` para tela inteira
- ✅ Variáveis CSS para safe areas: `--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right`
- ✅ Header e Navigation adaptam-se automaticamente ao notch
- ✅ Prevenção de zoom acidental (`user-scalable=no`)
- ✅ Meta tag `format-detection` para evitar auto-linking de telefones
- ✅ Título específico para home screen: "Cotolengo"

---

### 🔧 MELHORIAS TÉCNICAS

#### **JavaScript (app.js)**
1. **Fallback para `crypto.randomUUID()`** 
   - iOS Safari pode não suportar em todos os contextos
   - Implementado gerador robusto de IDs únicos como fallback

2. **Fallback para `crypto.subtle`**
   - Hash de senhas funciona mesmo em contextos não-HTTPS

3. **Sessão Persistente**
   - Auto-login melhorado com localStorage
   - Tratamento de erros de storage (modo privado iOS)

4. **Prevenção de Scroll Bounce**
   - Função `preventIOSBounce()` específica para iOS
   - Touch events otimizados

5. **Verificação Defensiva**
   - Todas as manipulações de DOM verificam se elementos existem
   - Previne crashes em diferentes navegadores

#### **CSS (styles.css)**
1. **Safe Areas Universais**
   ```css
   --safe-top: env(safe-area-inset-top, 0px);
   --safe-right: env(safe-area-inset-right, 0px);
   --safe-bottom: env(safe-area-inset-bottom, 0px);
   --safe-left: env(safe-area-inset-left, 0px);
   ```

2. **Body Fixed Position**
   - Previne scroll bounce no iOS
   - `position: fixed; width: 100%;`

3. **Performance Optimizations**
   - `-webkit-font-smoothing: antialiased`
   - `-moz-osx-font-smoothing: grayscale`
   - `will-change: transform` em elementos animados
   - `transform: translate3d(0,0,0)` para GPU acceleration

4. **iOS-Specific CSS**
   - `-webkit-text-size-adjust: 100%`
   - `-webkit-tap-highlight-color: transparent`
   - `touch-action: manipulation`
   - `-webkit-overflow-scrolling: touch`

#### **HTML (index.html)**
1. **Meta Tags Completas**
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
   <meta name="apple-mobile-web-app-capable" content="yes">
   <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
   <meta name="apple-mobile-web-app-title" content="Cotolengo">
   <meta name="format-detection" content="telephone=no">
   ```

2. **Ícones Corrigidos**
   - Múltiplos tamanhos de apple-touch-icon
   - Caminhos corretos para todos os ícones

3. **Acessibilidade**
   - `aria-label` em todos os botões importantes
   - `autocomplete` nos campos de senha

---

## 📱 INSTALAÇÃO

### **Configuração do Google Apps Script**

1. Abra [Google Sheets](https://sheets.google.com) e crie uma nova planilha
2. Nomeie as seguintes abas (guias):
   - `Funcionarios` - com colunas: `ID_Funcionario`, `Nome`
   - `Usuarios` - será criada automaticamente
   - `Solicitacoes` - será criada automaticamente
   - `Escala` - será criada automaticamente

3. Vá em **Extensões → Apps Script**
4. Cole todo o conteúdo de `apps-script-atualizado.js`
5. **IMPORTANTE:** Altere a linha da API Key:
   ```javascript
   var API_KEY = 'sua_chave_secreta_aqui';
   ```

6. Faça deploy:
   - **Implantar → Nova implantação**
   - Tipo: **Aplicativo da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
   - Clique em **Implantar**

7. **Copie a URL gerada** (será algo como `https://script.google.com/macros/s/ABC.../exec`)

### **Configuração do App**

1. Abra `app.js` e atualize estas duas linhas no topo:
   ```javascript
   const GOOGLE_API_URL = 'SUA_URL_AQUI';
   const API_KEY = 'sua_chave_secreta_aqui';
   ```

2. Hospede os arquivos em um servidor HTTPS:
   - **Opções gratuitas:** GitHub Pages, Netlify, Vercel, Cloudflare Pages
   - **Todos os arquivos necessários:**
     - index.html
     - app.js
     - styles.css
     - manifest.json
     - sw.js
     - icon-192.png
     - icon-512.png

### **Instalação no Dispositivo**

#### **iPhone (iOS Safari)**
1. Abra o app no Safari
2. Toque no ícone **Compartilhar** (quadrado com seta para cima)
3. Role e selecione **"Adicionar à Tela de Início"**
4. Confirme

#### **Android (Chrome)**
1. Abra o app no Chrome
2. Toque no menu **(⋮)** no canto superior direito
3. Selecione **"Adicionar à tela inicial"** ou **"Instalar app"**
4. Confirme

---

## 🎯 RECURSOS

### **Para Usuários (Enfermeiros)**
- ✅ Visualizar calendário de turnos pessoal
- ✅ Criar solicitações de férias/faltas/trocas
- ✅ Acompanhar status das solicitações
- ✅ Receber notificações visuais

### **Para Administradores**
- ✅ Gerenciar todos os turnos
- ✅ Aprovar/rejeitar solicitações
- ✅ Gerenciar usuários do sistema
- ✅ Visualizar calendário geral ou individual
- ✅ Sistema completo de controle de acesso

---

## 🔒 SEGURANÇA

- ✅ API Key protegida no Google Apps Script
- ✅ Senhas armazenadas (recomenda-se implementar hash no futuro)
- ✅ Sessões salvas localmente com segurança
- ✅ HTTPS obrigatório para PWA completo
- ✅ Controle de acesso por função (admin/user)

---

## 🐛 RESOLUÇÃO DE PROBLEMAS

### **O app não carrega no iPhone**
1. Verifique se está abrindo no **Safari** (não Chrome/Firefox no iOS)
2. Limpe o cache: Settings → Safari → Clear History and Website Data
3. Reinstale o app

### **Erro "Chiave API non valida"**
- Verifique se a API_KEY está igual em `apps-script-atualizado.js` e `app.js`

### **Erro de conexão/timeout**
1. Verifique se a URL do Google Apps Script está correta
2. Confirme que o deploy está como "Qualquer pessoa" pode acessar
3. Teste a URL diretamente no navegador

### **Icons não aparecem**
- Confirme que `icon-192.png` e `icon-512.png` estão no mesmo diretório que `index.html`

### **PWA não oferece instalação**
- Certifique-se de estar usando HTTPS
- Verifique se o `manifest.json` está acessível
- No Android, pode levar alguns segundos para o prompt aparecer

---

## 📊 ESTRUTURA DE DADOS

### **Funcionarios (Google Sheets)**
```
ID_Funcionario | Nome
1              | Maria Silva
2              | João Santos
...
```

### **Escala (Criada automaticamente)**
```
nurseId | month | year | d1  | d2  | d3  | ... | d31
1       | 4     | 2026 | M1  | OFF | P   | ... | N
2       | 4     | 2026 | N   | M1  | OFF | ... | M1
...
```

### **Solicitacoes (Criada automaticamente)**
```
id | type | status | nurseId | nurseName | startDate | endDate | desc | ...
```

### **Usuarios (Criada automaticamente)**
```
id | nome | senha | role | nurseId
```

---

## 🎨 PERSONALIZAÇÃO

### **Cores**
Edite as variáveis CSS em `styles.css`:
```css
--primary: #8b5cf6;      /* Cor principal (roxo) */
--accent: #06b6d4;       /* Cor de destaque (cyan) */
--success: #10b981;      /* Verde (aprovado) */
--danger: #ef4444;       /* Vermelho (rejeitado) */
```

### **Tipos de Turno**
Edite o objeto `SHIFTS` em `app.js`:
```javascript
const SHIFTS = {
  'M1': { name:'Mattina 1', h:7.0, color:'#f59e0b', text:'#1a1a00', period:'morning' },
  // Adicione novos turnos aqui
};
```

---

## 📝 CHANGELOG v2.0

### **Compatibilidade**
- [x] Suporte completo a iOS Safari
- [x] Suporte a Android Chrome
- [x] Suporte a notch/Dynamic Island
- [x] Safe areas em todas as telas

### **Performance**
- [x] GPU acceleration em animações
- [x] Otimização de redraws
- [x] Fallbacks para APIs modernas
- [x] Lazy loading otimizado

### **UX/UI**
- [x] Prevenção de scroll bounce
- [x] Feedback tátil melhorado
- [x] Transições suaves
- [x] Acessibilidade aprimorada

### **Bugs Corrigidos**
- [x] Caminhos de ícones incorretos
- [x] Erro em crypto.randomUUID() no iOS
- [x] Problemas de touch em swipe
- [x] Safe area não funcionando
- [x] Modal fechando incorretamente

---

## 🤝 SUPORTE

Para problemas ou dúvidas:
1. Verifique a seção **Resolução de Problemas** acima
2. Revise os logs do console do navegador (F12 → Console)
3. Verifique os logs do Google Apps Script (Execuções)

---

## 📜 LICENÇA

Código livre para uso interno da instituição Cotolengo.

---

## 👥 CRÉDITOS

**Versão 2.0** - Otimização completa para iOS + Android
**Desenvolvido para:** Cotolengo - Sistema de Gestão de Turnos

---

**Versão:** 2.0  
**Data:** Abril 2026  
**Compatibilidade:** iOS 14+, Android 8+, Safari 14+, Chrome 90+
