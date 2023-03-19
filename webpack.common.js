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
        salsa_lesson: './src/demo/salsa_lesson/src',
        elements: './src/demo/elements/src',
        ocean: './src/demo/ocean/src',
        ship: './src/demo/ship/src',
        beach: './src/demo/beach/src',
        bvh_test: './src/demo/bvh_test/src',
        bvh_test_2: './src/demo/bvh_test_2/src',
        salsa_party: './src/demo/salsa_party/src',
        salsa_party2: './src/demo/salsa_party2/src',
        salsa_party3: './src/demo/salsa_party3/src',
        handinput_profiles: './src/demo/handinput_profiles/src',
    },
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/
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
        filename: 'src/demo/[name]/dist/bundle.js'
    }
};
