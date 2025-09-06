
# ESPN Fantasy AI — Desktop (versão simples)
**Instalação 1 clique + Login automático (sem Docker, sem cookies manuais).**

## Como gerar o instalador (Windows)
1. Instale o **Node.js LTS** (temporário só para gerar).
2. Dentro da pasta do projeto:
   ```bash
   npm install
   npx electron-forge import   # roda uma única vez se solicitado
   npm run make
   ```
3. Abra `out/make/squirrel.windows/` e execute `ESPN_Fantasy_AI-Setup.exe`.
4. Ao abrir o app, clique **Conectar com ESPN** e faça login normal. O app detecta o login e volta **Conectado**.

> Se preferir, posso te enviar o `.exe` pronto (sem Node) — este projeto já está preparado para gerar isso.
