module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  moduleDirectories: ['node_modules', 'src'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
}; 