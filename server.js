'use strict';

const http = require('node:http');
const handler = require('./api/index');

const port = Number(process.env.PORT || 3000);
const server = http.createServer((req, res) => handler(req, res));
server.listen(port, '127.0.0.1', () => console.log(`Black Node ZW API listening on http://127.0.0.1:${port}`));
