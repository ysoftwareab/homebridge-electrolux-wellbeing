"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = void 0;
const axios_1 = __importDefault(require("axios"));
const axios_auth_refresh_1 = __importDefault(require("axios-auth-refresh"));
const baseUrl = 'https://api.delta.electrolux.com/api';
const clientUrl = 'https://electrolux-wellbeing-client.vercel.app/api/mu52m5PR9X';
exports.createClient = async ({ username, password }) => {
    const clientToken = await fetchClientToken();
    const response = await doLogin({
        username,
        password,
        clientToken,
    });
    const { accessToken } = response.data;
    const client = axios_1.default.create({
        baseURL: baseUrl,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
    });
    axios_auth_refresh_1.default(client, (failedRequest) => doLogin({
        username,
        password,
        clientToken,
    }).then((tokenRefreshResponse) => {
        client.defaults.headers.common.Authorization = `Bearer ${tokenRefreshResponse.data.accessToken}`;
        failedRequest.response.config.headers['Authorization'] = `Bearer ${tokenRefreshResponse.data.accessToken}`;
        return Promise.resolve();
    }), {
        statusCodes: [400, 401],
    });
    return client;
};
const fetchClientToken = async () => {
    const response = await axios_1.default.get(clientUrl, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
    return response.data.accessToken;
};
const doLogin = async ({ username, password, clientToken }) => axios_1.default.post(`${baseUrl}/Users/Login`, {
    Username: username,
    password: password,
}, {
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientToken}`,
    },
});
//# sourceMappingURL=api.js.map