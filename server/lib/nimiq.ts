import nimiq from '@nimiq/core';
import Pay from './model/pay';
import Log from './model/log';
import {User} from './model/user';

export type Request = {
	recipient?: string, level?: number, hash?: string
}
export default class Nimiq {
	public static consensus: nimiq.NanoConsensus;
	public static blockchain: nimiq.NanoChain;
	public static established: boolean = false;
	public static pool: nimiq.NanoMempool;
	public static network: nimiq.Network;
	private static wallet: nimiq.Wallet;

	public static async log(recipient: string, message: string, params: Object = {}) {
		const row = new Log({recipient: recipient, params: params, message: message});
		await row.save();
	}

	public static async setup() {
		const hex = process.env.NIMIQ_PRIVATE_KEY_HEX as string;
		const buf = nimiq.BufferUtils.fromHex(hex);
		const pk = nimiq.PrivateKey.unserialize(buf);
		const kp = nimiq.KeyPair.derive(pk);
		Nimiq.wallet = new nimiq.Wallet(kp);
		process.env.NIMIQ_NETWORK === 'main' ? nimiq.GenesisConfig.main() : nimiq.GenesisConfig.test();
		Nimiq.consensus = await nimiq.Consensus.nano();
		Nimiq.blockchain = Nimiq.consensus.blockchain;
		Nimiq.network = Nimiq.consensus.network;
		Nimiq.pool = Nimiq.consensus.mempool;
		Nimiq.network.connect();
		Nimiq.consensus.on('established', () => {
			Nimiq.established = true;
			Nimiq.consensus.subscribeAccounts([Nimiq.wallet.address]);
		});
		Nimiq.consensus.on('lost', () => {
			Nimiq.established = false;
		});
	}

	public static async pay(user: User, level: number, ip: string) {
		if (!Nimiq.established) {
			await this.log('', 'Cannot send transaction, dont have consensus');
			return 0;
		}
		let account = await Nimiq.consensus.getAccount(Nimiq.wallet.address);
		if (!nimiq.Policy.satoshisToCoins(account.balance)) {
			await this.log('', 'Balance is zero');
			return 0;
		}
		try {
			const address = nimiq.Address.fromString(user.recipient);
			let reward = level * 0.002;
			if (reward > 0.15) reward = 0.15;
			const lunas = nimiq.Policy.coinsToLunas(reward);
			const tx = Nimiq.wallet.createTransaction(address, lunas, 0, Nimiq.blockchain.height);
			await Nimiq.consensus.sendTransaction(tx);
			const pay = new Pay({
				ip: ip,
				hash: user.hash,
				lunas: lunas,
				level: level,
				reward: reward,
				hash_tx: tx.hash().toHex(),
				recipient: address.toUserFriendlyAddress()
			});
			await pay.save();
			user.times++;
			user.hash = '';
			user.amount += reward;
			user.last_request_at = new Date(Date.now());
			await user.save();
			return reward;
		} catch (error) {
			await this.log(user.recipient, error.message, {hash: user.hash, level: level, ip: ip});
		}
		return 0;
	}

	public static checkRecipient(addr: string): nimiq.Address {
		return nimiq.Address.fromString(addr);
	}
}