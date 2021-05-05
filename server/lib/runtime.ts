import parser from 'body-parser';
import express from 'express';
import https from 'https';
import destr from 'destr';
import cors from 'cors';
import fs from 'fs';
import nimiq from './nimiq';
import User from './model/user';

export default class Runtime {
	static isOriginAllowed(req: express.Request) {
		return req.get('origin') === process.env.WEBSITE_HOST as string;
	}

	static randomString() {
		let result = '';
		const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		const charactersLength = characters.length;
		for (let i = 0; i < 64; i++) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));
		}
		return result;
	}

	public static setup() {
		const app = express();
		app.use(cors({origin: process.env.WEBSITE_HOST as string, optionsSuccessStatus: 200}));
		app.use(parser.text());
		/** POST /request {recipient} {hash} */
		app.post('/request', async (req, res) => {
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			let params = req.body ? destr(req.body) : {};
			if (!this.isOriginAllowed(req) || !ip || !params || !params.recipient) return res.end('Forbidden'); // Origin not allowed
			let recipient = params.recipient;
			const ipList = (process.env.NIMIQ_DENY_IPS as string).split(',');
			ip.split(',').forEach(v => {
				if (v !== '' && ipList.includes(v)) return res.end('Forbidden'); // Deny ip
			});
			const addressList = (process.env.NIMIQ_DENY_ADDRESSES as string).split(',');
			if (addressList.includes(recipient)) {
				let result: string[] = [], tmp = '', hash = this.randomString();
				hash.split('').forEach(v => {
					if (tmp.length == 24) {
						result.push(tmp);
						tmp = '';
					}
					tmp += (v.charCodeAt(0) + '').padStart(3, '0');
				});
				if (tmp) result.push(tmp);
				return res.send(new Buffer(result.join('-')));
			}
			try {
				nimiq.checkRecipient(recipient);
				let row = await User.findOne({
					date: new Date(Date.now()).toLocaleDateString(), recipient: recipient
				});
				if (!row) {
					row = new User({
						ip: ip, recipient: recipient, hash: this.randomString(), date: new Date(Date.now()).toLocaleDateString()
					});
					await row.save();
				} else {
					if (row.amount >= 5 || row.times > 50) return res.end('Forbidden');
					if (!row.hash) {
						row.hash = this.randomString();
						await row.save();
					}
				}
				let result: string[] = [], tmp = '';
				row.hash.split('').forEach(v => {
					if (tmp.length == 24) {
						result.push(tmp);
						tmp = '';
					}
					tmp += (v.charCodeAt(0) + '').padStart(3, '0');
				});
				if (tmp) result.push(tmp);
				return res.send(new Buffer(result.join('-')));
			} catch (error) {
				await nimiq.log(recipient, error, params);
				return res.end('Forbidden');
			}
		});
		/** POST / {recipient,level} {} */
		app.post('/', async (req, res) => {
			if (!this.isOriginAllowed(req)) return res.end('Forbidden'); // Origin not allowed
			let param = req.body as string;
			if (!/^\d{24}(-\d{24}){42}$/.test(param)) return res.end('Forbidden'); // Params error
			let items = param.split('-');
			let hash = items.slice(36), hashStr = '';
			hash.unshift(items[0]);
			hash.forEach(r => {
				let rs = r.match(/\d{3}/g) as Array<string>;
				rs.push(r.substring(rs.join('').length));
				rs.forEach(s => {
					let code = Number(s);
					if (!isNaN(code) && code > 0) {
						// @ts-ignore
						hashStr += String.fromCharCode(code);
					}
				});
			});
			let data = items.slice(1, 36), dataStr = '';
			data.forEach(r => {
				let rs = r.match(/\d{3}/g) as Array<string>;
				rs.push(r.substring(rs.join('').length));
				rs.forEach(s => {
					let code = Number(s);
					if (!isNaN(code) && code > 0) {
						// @ts-ignore
						dataStr += String.fromCharCode(code);
					}
				});
			});
			let params = destr(dataStr);
			if (!/^[a-zA-Z0-9]{64}$/.test(hashStr) || !params || !params.key || !params.recipient || !params.level || parseInt(params.level) < 0 || parseInt(params.level) > 100) {
				return res.end('Forbidden'); // Params error
			}
			let key = [], tmp = '';
			hashStr.split('').forEach(v => {
				if (tmp.length == 24) {
					key.push(tmp);
					tmp = '';
				}
				tmp += (v.charCodeAt(0) + '').padStart(3, '0');
			});
			if (tmp) key.push(tmp);
			if (key.join('-') != params.key || params.level < 3) return res.end('Forbidden'); // Params error
			let time = new Date();
			time.setSeconds(time.getSeconds() - 5);
			let user = await User.findOne({
				date: new Date(Date.now()).toLocaleDateString(),
				recipient: params.recipient as string,
				times: {$lt: 100},
				amount: {$lt: 5},
				last_request_at: {$lte: time}
			});
			if (!user) return res.end('Forbidden'); // Invalid parameters or frequent requests
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			let reward = (await nimiq.pay(user, params.level as number, ip)) as number;
			let result = reward > 0 ? Number(reward.toFixed(6)).toString() : 'Forbidden';
			return res.end(result);
		});
		//
		app.use(express.static(__dirname + '/../../public'));
		//
		let keyFilename = process.env.SSL_KEY_FILE_PATH as string, certFilename = process.env.SSL_CERT_FILE_PATH as string
		const key = keyFilename ? fs.readFileSync(keyFilename) : false;
		const cert = certFilename ? fs.readFileSync(certFilename) : false;
		if (key && cert) {
			const server = https.createServer({key: key, cert: cert}, app);
			server.listen(process.env.SERVER_PORT as string, function () {
				console.log('Server run OK...');
			});
			return;
		}
		app.listen(process.env.SERVER_PORT as string);
		console.log('Server run OK...');
	}
}