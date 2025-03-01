const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const fs = require('fs');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    devServer: {
        host: '0.0.0.0', // Allows external connections to localhost
        port: 8081,
        server: {
            type: 'https',
            options: {
                key: fs.readFileSync('certs/key.pem'),
                cert: fs.readFileSync('certs/cert.pem')
            }
        },
        allowedHosts: "all"
    }
});
