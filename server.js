require('dotenv').config();

const { build } = require('./app');

const FRONT_PORT = parseInt(process.env.FRONTEND_PORT || '5000', 10);
const { server, UPLOAD_PATH } = build();

server.listen(FRONT_PORT, () => {
    console.log(`Dropfile media-controller running on port ${FRONT_PORT}`);
    console.log(`Admin: /admin   Media root: ${UPLOAD_PATH}`);
});
