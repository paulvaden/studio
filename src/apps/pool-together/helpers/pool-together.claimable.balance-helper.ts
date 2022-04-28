import { Inject } from '@nestjs/common';

import { drillBalance } from '~app-toolkit';
import { buildDollarDisplayItem } from '~app-toolkit/helpers/presentation/display-item.present';
import { getTokenImg } from '~app-toolkit/helpers/presentation/image.present';
import { APP_TOOLKIT, IAppToolkit } from '~lib';
import { ContractType } from '~position/contract.interface';
import { ContractPositionBalance } from '~position/position-balance.interface';
import { Network } from '~types/network.interface';

import { PoolTogetherContractFactory } from '../contracts';
import { POOL_TOGETHER_DEFINITION } from '../pool-together.definition';

import { PoolTogetherPrizeTicketTokenDataProps } from './pool-together.prize-ticket.token-helper';

type GetClaimableTokenBalanceParams = {
  address: string;
  network: Network;
};

export class PoolTogetherClaimableTokenBalancesHelper {
  constructor(
    @Inject(APP_TOOLKIT) private readonly appToolkit: IAppToolkit,
    @Inject(PoolTogetherContractFactory) private readonly contractFactory: PoolTogetherContractFactory,
  ) {}

  async getBalances({ address, network }: GetClaimableTokenBalanceParams) {
    const multicall = this.appToolkit.getMulticall(network);
    const prices = await this.appToolkit.getBaseTokenPrices(network);

    const poolTogetherTokens = await this.appToolkit.getAppTokenPositions<PoolTogetherPrizeTicketTokenDataProps>({
      appId: POOL_TOGETHER_DEFINITION.id,
      groupIds: [POOL_TOGETHER_DEFINITION.groups.prizeTicket.id],
      network: network,
    });

    const allFaucetAddresses = poolTogetherTokens.flatMap(token => token.dataProps.faucetAddresses);
    const claimableBalances = await Promise.all(
      allFaucetAddresses.map(async faucetAddress => {
        const faucetContract = this.contractFactory.poolTogetherPoolFaucet({ address: faucetAddress, network });
        const [rewardTokenAddressRaw, claimableBalanceRaw] = await Promise.all([
          multicall.wrap(faucetContract).asset(),
          multicall.wrap(faucetContract).callStatic.claim(address),
        ]);

        const rewardTokenAddress = rewardTokenAddressRaw.toLowerCase();
        const rewardBaseToken = prices.find(p => p.address === rewardTokenAddress);
        const rewardPoolTogetherAppToken = poolTogetherTokens.find(p => p.address === rewardTokenAddress);
        const rewardToken = rewardPoolTogetherAppToken ?? rewardBaseToken;
        if (!rewardToken) return null;

        const rewardTokenBalance = drillBalance(rewardToken, claimableBalanceRaw.toString());
        const tokens = [rewardTokenBalance];
        const balanceUSD = rewardTokenBalance.balanceUSD;

        // Display Props
        const label = `Claimable ${
          rewardToken.type === ContractType.BASE_TOKEN ? rewardToken.symbol : rewardToken.displayProps.label
        }`;
        const secondaryLabel = buildDollarDisplayItem(rewardToken.price);
        const images =
          rewardToken.type === ContractType.BASE_TOKEN
            ? [getTokenImg(rewardToken.address, network)]
            : rewardToken.displayProps.images;

        const positionBalance: ContractPositionBalance = {
          type: ContractType.POSITION,
          address: faucetAddress,
          appId: POOL_TOGETHER_DEFINITION.id,
          groupId: POOL_TOGETHER_DEFINITION.groups.claimable.id,
          network,
          tokens,
          balanceUSD,

          dataProps: {},

          displayProps: {
            label,
            secondaryLabel,
            images,
          },
        };

        return positionBalance;
      }),
    );

    return claimableBalances;
  }
}