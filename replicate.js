const DEFAULT_BASE_URL = "https://api.replicate.com/v1"
const DEFAULT_POLLING_INTERVAL = 5000

const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(), ms))
const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

// DISABLED FOR CLOUDFLARE SUPPORT. Globally scoped await isn't supported on Cloudflare.
//// This code uses fetch, which is still experimental in Node 18, so we import a polyfill for Node
// if(isNode)
//     globalThis.fetch = (await import('node-fetch'))['default'];

class Replicate {

    token;
    proxyUrl;
    httpClient;
    pollingInterval;
    baseUrl;
    headers;

    constructor(options) {
        Object.assign(this, options);

        // Uses some lesser-known operators to make null-safety easy
        this.baseUrl ||= DEFAULT_BASE_URL;
        this.pollingInterval ||= DEFAULT_POLLING_INTERVAL;
        this.token ||= (isNode) ? process?.env?.REPLICATE_API_TOKEN : null;
        if (!this.token && !this.proxyUrl)
            throw new Error('Missing Replicate token')

        // Depedency injection for tests
        if(!this.httpClient)
            this.httpClient = new HTTPClient({proxyUrl: this.proxyUrl, token: this.token, baseUrl: this.baseUrl, headers: this.headers});

        // Syntax sugar to support replicate.models.get()
        this.models = { get: this.getModel.bind(this) }
    }

    async getModel(path, version) {
        return await Model.fetch({ path: path, version: version, replicate: this});
    }
}

class Model {

    path;
    version;
    httpClient;
    pollingInterval;

    static async fetch(options){
        const model = new Model(options);
        await model.getModelDetails();
        return model;
    }

    constructor(options) {
        Object.assign(this, options) //path, version
        Object.assign(this, options.replicate) //httpClient, pollingInterval
    }

    async getModelDetails() {
        const response = await this.httpClient.get(`/models/${this.path}/versions`);
        const modelVersions = response.results;
        const mostRecentVersion = modelVersions[0];
        const explicitlySelectedVersion = modelVersions.find((m) => m.id == this.version);
        this.modelDetails = explicitlySelectedVersion ? explicitlySelectedVersion : mostRecentVersion;
        if(this.version && this.version !== this.modelDetails.id){
            console.warn(`Model (version:${this.version}) not found, defaulting to ${mostRecentVersion.id}`);
        }
    }

    async *predictor(input) {
        const predictionId = await this.startPrediction(input);
        let predictionStatus;
        do {
            const checkResponse = await this.httpClient.get(`/predictions/${predictionId}`)
            predictionStatus = checkResponse.status;
            await sleep(this.pollingInterval);
            yield checkResponse.output;
        } while (['starting', 'processing'].includes(predictionStatus))
    }

    async startPrediction(input) {
        const startRequest = { "version": this.modelDetails.id, "input": input };
        const prediction = await this.httpClient.post(`/predictions`, startRequest);
        return prediction.id;
    }

    async predict(input) {
        let prediction;
        for await (prediction of this.predictor(input)) {
            // console.log(prediction);
        }
        return prediction;
    }
}

// This class just makes it a bit easier to call fetch -- interface similar to the axios library
export class HTTPClient{

    baseUrl;
    headers;

    constructor(options){
        this.baseUrl = options.proxyUrl ? `${options.proxyUrl}/${options.baseUrl}` : options.baseUrl;
        this.headers ||= {};
        this.headers['Authorization'] = `Token ${options.token}`
        this.headers['Content-Type'] = 'application/json'
        this.headers['Accept'] = 'application/json'
    }

    async get(url){
        const response = await fetch(`${this.baseUrl}${url}`, { headers: this.headers });
        return await response.json();
    }

    async post(url, body){
        const fetchOptions = { method: 'POST', headers: this.headers, body: JSON.stringify(body) }
        const response = await fetch(`${this.baseUrl}${url}`, fetchOptions);
        return await response.json();
    }
}

export default Replicate
