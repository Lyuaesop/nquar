import nimiq from '@nimiq/core';
import Pay from './model/pay';
import Log from './model/log';
import {User} from './model/user';

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

	public static async pay(user: User, level: number, ip: string, geo: string) {
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
			if (!user.hash) return 0;
			const address = nimiq.Address.fromString(user.recipient);
			let reward = level * 0.002;
			if (level >= 20) {
				reward += 5;
			} else if (level >= 10) {
				reward += 1;
			} else if (level >= 8) {
				reward += 0.1;
			} else if (level >= 5) {
				reward += 0.05;
			}
			reward = parseFloat(reward.toFixed(3));
			const lunas = nimiq.Policy.coinsToLunas(reward);
			const tx = Nimiq.wallet.createTransaction(address, lunas, 0, Nimiq.blockchain.height);
			await Nimiq.consensus.sendTransaction(tx);
			const pay = new Pay({
				ip: ip,
				geo: geo,
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
			user.max_level = Math.max(user.max_level, level);
			user.last_request_at = new Date(Date.now());
			await user.save();
			return reward;
		} catch (error) {
			await this.log(user.recipient, error.message, {hash: user.hash, level: level, ip: ip});
		}
		return 0;
	}

	static generateHash() {
		let result = '';
		const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		const charactersLength = characters.length;
		for (let i = 0; i < 64; i++) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));
		}
		return result;
	}

	public static checkIp(ip: string) {
		if (!ip) return false;
		let ipList = (process.env.NIMIQ_DENY_IPS as string).split(',');
		ip.split(',').forEach(v => {
			if (v !== '' && ipList.includes(v)) return false;
		});
		return true;
	}

	public static checkRecipient(recipient: string, withHash: boolean = false) {
		let addressList = (process.env.NIMIQ_DENY_ADDRESSES as string).split(',');
		if (!recipient || addressList.includes(recipient)) {
			if (withHash) {
				let result: string[] = [], tmp = '', hash = this.generateHash();
				hash.split('').forEach(v => {
					if (tmp.length == 24) {
						result.push(tmp);
						tmp = '';
					}
					tmp += (v.charCodeAt(0) + '').padStart(3, '0');
				});
				if (tmp) result.push(tmp);
				return [false, result.join('-')];
			}
			return [false, ''];
		}
		nimiq.Address.fromString(recipient);
		return [true, ''];
	}
}
