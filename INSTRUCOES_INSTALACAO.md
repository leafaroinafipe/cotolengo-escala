# 📱 Cotolengo Escala — App Móvel (PWA)

## Como hospedar no GitHub Pages (GRATUITO)

### Passo 1: Criar conta no GitHub
1. Acesse [github.com](https://github.com) e clique em **"Sign up"**
2. Crie uma conta gratuita com seu e-mail

### Passo 2: Criar repositório
1. Após login, clique no botão **"+"** (canto superior direito) → **"New repository"**
2. Nome: `cotolengo-escala` (ou qualquer nome)
3. Marque **"Public"**
4. Clique em **"Create repository"**

### Passo 3: Fazer upload dos arquivos
1. Na página do repositório, clique em **"uploading an existing file"**
2. Arraste TODOS os arquivos desta pasta (Movel) para a área de upload:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `manifest.json`
   - `sw.js`
   - pasta `icons/` (se existir)
3. Clique em **"Commit changes"**

### Passo 4: Ativar GitHub Pages
1. Vá em **Settings** (aba Configurações do repositório)
2. No menu lateral, clique em **"Pages"**
3. Em **"Source"**, selecione **"Deploy from a branch"**
4. Em **"Branch"**, selecione **"main"** e pasta **"/ (root)"**
5. Clique em **"Save"**
6. Aguarde ~2 minutos

### Passo 5: Acessar o app!
O link do app será:
```
https://SEU-USUARIO.github.io/cotolengo-escala/
```

### Passo 6: Enviar para os funcionários
1. Compartilhe o link acima via WhatsApp
2. No celular, abra o link no navegador Chrome/Safari
3. Aparecerá um botão **"Instalar"** ou **"Adicionar à tela inicial"**
4. Pronto! O app fica na tela inicial como um app nativo 📱

---

## ⚠️ Atualização da URL da API

Após hospedar, se a URL mudar, edite a linha 8 do `app.js`:
```javascript
const GOOGLE_API_URL = 'SUA_URL_AQUI';
```

---

## 🍎 iPhone (iOS)
1. Abra o link no **Safari** (não funciona no Chrome do iPhone)
2. Toque no ícone de **Compartilhar** (quadrado com seta)
3. Toque em **"Adicionar à Tela de Início"**
4. Confirme

## 🤖 Android
1. Abra o link no **Chrome**
2. Aparecerá um banner **"Instalar app"** automaticamente
3. Se não aparecer: menu ⋮ → **"Instalar aplicativo"**
