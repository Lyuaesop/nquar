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
			if (!this.isOriginAllowed(req) || !ip || !params || !params.recipient) return res.send(new Buffer('Forbidden')); // Origin not allowed
			let recipient = params.recipient;
			const list = (process.env.NIMIQ_DENY_IPS as string).split(',');
			ip.split(',').forEach(v => {
				if (v !== '' && list.includes(v)) return res.send(new Buffer('Forbidden')); // Deny ip
			});
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
					if (row.amount >= 5 || row.times > 50) return res.send(new Buffer('Forbidden'));
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
				return res.send(new Buffer('Forbidden'));
			}
		});
		/** POST / {recipient,level} {} */
		app.post('/', async (req, res) => {
			if (!this.isOriginAllowed(req)) return res.send(new Buffer('Forbidden')); // Origin not allowed
			let param = req.body as string;
			if (!/^\d{24}(-\d{24}){42}$/.test(param)) return res.send(new Buffer('Forbidden')); // Params error
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
				return res.send(new Buffer('Forbidden')); // Params error
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
			if (key.join('-') != params.key) return res.send(new Buffer('Forbidden')); // Params error
			let time = new Date();
			time.setSeconds(time.getSeconds() - 5);
			let user = await User.findOne({
				date: new Date(Date.now()).toLocaleDateString(),
				recipient: params.recipient as string,
				times: {$lt: 100},
				amount: {$lt: 5},
				last_request_at: {$lte: time}
			});
			if (!user) return res.send(new Buffer('Forbidden')); // Invalid parameters or frequent requests
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			let reward = parseInt(params.level) * 0.002;
			let result = await nimiq.pay(user, reward, ip) ? Number(reward.toFixed(6)).toString() : 'Forbidden';
			return res.send(new Buffer(result));
		});
		//
		app.use(express.static(__dirname + '/../../public'));
		//
		const key = fs.readFileSync(process.env.SSL_KEY_FILE_PATH as string);
		const cert = fs.readFileSync(process.env.SSL_CERT_FILE_PATH as string);
		const server = https.createServer({key: key, cert: cert}, app);
		server.listen(process.env.SERVER_PORT as string, function () {
			console.log('Server run OK...');
		});
	}
}