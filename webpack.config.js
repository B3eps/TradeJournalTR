const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
    entry: {
        app: './client/trades.jsx',
    },
    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                },
            },
            {
                test: /\.css$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    'css-loader',
                    'postcss-loader',
                ],
            },
        ],
    },
    plugins: [
        new MiniCssExtractPlugin({
            filename: '[name].css',
        }),
    ],
    resolve: {
        extensions: ['.js', '.jsx'],
        alias: {
            // lightweight-charts exposes only an "import" condition; pages use require().
            'lightweight-charts$': path.resolve(__dirname, 'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs'),
            // framer-motion's optional dependency (not installed, not needed): silences "Module not found".
            '@emotion/is-prop-valid': false,
        },
    },
    mode: 'production',
    watchOptions: {
        aggregateTimeout: 200,
    },
    output: {
        path: path.resolve(__dirname, 'public/assets'),
        filename: '[name]Bundle.js',
    },
};
