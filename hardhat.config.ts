import '@nomicfoundation/hardhat-toolbox';

import { HardhatUserConfig } from 'hardhat/config';
import { SolcUserConfig } from 'hardhat/types';

// const config: HardhatUserConfig = {
//   solidity: "0.8.17",
// };

const settings: SolcUserConfig = {
  settings: {
    outputSelection: {
      '*': {
        '*': ['storageLayout']
      }
    }
  },
  version: '0.8.17'
};

const config: HardhatUserConfig = {
  solidity: {
    compilers: [settings]
  }
};

export default config;
