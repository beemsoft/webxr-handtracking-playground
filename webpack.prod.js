const merge = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'production',
    devtool: 'source-map',
    performance: {
        hints: false
    },
    module: {
        rules: [
            {
                test: /\.(mp3)$/,
                use: [{
                    loader: 'file-loader',
                    options: {
                        name: '[name].[ext]',
                        publicPath: '/vr/public/sound'
                    }
                }]
            },
            {
                test: /\.(vrm)$/,
                use: [{
                    loader: 'file-loader',
                    options: {
                        name: '[name].[ext]',
                        publicPath: '/vr/public/shared/vrm'
                    }
                }]
            },
            {
                test: /\.(bvh)$/,
                use: [{
                    loader: 'file-loader',
                    options: {
                        name: '[name].[ext]',
                        publicPath: '/vr/public/shared/bvh'
                    }
                }]
            }
        ]
    }
});
