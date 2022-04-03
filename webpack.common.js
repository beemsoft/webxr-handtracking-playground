const path = require('path');
const webpack = require('webpack');

const plugins = [
    new webpack.ProvidePlugin({
        THREE: "three"
    }),
    new webpack.ProvidePlugin({
        CANNON: "cannon-es"
    })
];

module.exports = {
    entry: {
        ball: './src/demo/ball/src',
        get_ball: './src/demo/get_ball/src',
        dance: './src/demo/dance/src',
        vrm_animation: './src/demo/vrm_animation/src',
        vrm_dance: './src/demo/vrm_dance/src',
        bar: './src/demo/bar/src',
        bar2: './src/demo/bar2/src',
        salsa_lesson: './src/demo/salsa_lesson/src'
    },
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            },
            {
                test: /\.(mp3)$/,
                use: [{
                    loader: 'file-loader',
                    options: {
                        name: '[name].[ext]',
                        publicPath: '/sound'
                    }
                }]
            },
            {
                test: /\.(vrm)$/,
                use: [{
                    loader: 'file-loader',
                    options: {
                        name: '[name].[ext]',
                        publicPath: '/shared/vrm'
                    }
                }]
            },
            {
                test: /\.(bvh)$/,
                use: [{
                    loader: 'file-loader',
                    options: {
                        name: '[name].[ext]',
                        publicPath: '/shared/bvh'
                    }
                }]
            }
        ]
    },
    plugins: plugins,
    resolve: {
        extensions: [ '.tsx', '.ts', '.js' ]
    },
    optimization: {
        splitChunks: {
            cacheGroups: {
                commons: {
                    name: 'commons',
                    chunks: 'all'
                }
            }
        }
    },
    output: {
        publicPath: "/",
        filename: 'src/demo/[name]/dist/bundle.js'
    }
};
