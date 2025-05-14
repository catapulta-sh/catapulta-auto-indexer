# Catapulta Auto Indexer

## Getting Started with Dev Container

1. [Install Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) 

2. [Install Dev Container Extension in VSCode or Cursor](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

3. Clone this repository and open it in VSCode or Cursor: 
```
git clone git@github.com:catapulta-sh/catapulta-auto-indexer.git
code catapulta-auto-indexer
```
4. Editor will prompt to load the dev container, click to open the Dev Container environment, as the image:
![Imagen de WhatsApp 2025-05-13 a las 18 26 51_4066ae66](https://github.com/user-attachments/assets/33088c74-04a7-42fa-a81a-4412520f446d)

5. Once it loads, open a Terminal and run the following commands to check if the environment is working:
```
bun -v
rustc --v
rindexer -V
```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.
