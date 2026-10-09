# EverOnn WAAS client

Install the included SDK with npm install ./path/to/waas-package/sdk, or run npm run sdk:pack in the service and install the resulting .tgz in your app.

Import createWaasClient from @everonn/waas-client and configure baseUrl (the service origin) and apiKey (WAAS_API_KEY). The SDK needs Node.js 22+ and has no dependencies.

Call generate(siteId) to build, or generate(siteId, { resume: true }) after interruption. Generation makes paid calls to your configured Gemini account. Keep keys on your server and authorize your own users before exposing SDK operations. Publishing requires approved: true, the current draft ID and current live release ID. See the service README and examples/ for setup and embedding.
