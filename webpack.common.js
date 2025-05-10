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
        salsa_party4: './src/demo/salsa_party4/src',
        handinput_profiles: './src/demo/handinput_profiles/src',
        mediapipe_face: './src/demo/mediapipe_face/src',
        mediapipe_face_vrm: './src/demo/mediapipe_face_vrm/src',
        webxr_vr_postprocessing: './src/demo/webxr_vr_postprocessing/src',
        webxr_vr_postprocessing_unreal_bloom: './src/demo/webxr_vr_postprocessing_unreal_bloom/src',
        moon_walk: './src/demo/moon_walk/src',
        webgl_water: './src/demo/webgl_water/src',
        threejs_water: './src/demo/threejs_water/src',
        threejs_physics_ammo_break: './src/demo/threejs_physics_ammo_break/src',
        threejs_physics_ammo_break_movable: './src/demo/threejs_physics_ammo_break_movable/src',
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
        extensions: [ '.tsx', '.ts', '.js' ],
        fallback: {
            fs: false,
            'path': false, // ammo.js seems to also use path
        }
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
    },
    experiments: {
        topLevelAwait: true
    }
};
