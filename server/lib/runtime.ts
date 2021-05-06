import parser from 'body-parser';
import geoIp from 'geoip-lite';
import express from 'express';
import https from 'https';
import destr from 'destr';
import cors from 'cors';
import fs from 'fs';
import nimiq from './nimiq';
import User from './model/user';

export default class Runtime {
	static isOriginAllowed(req: express.Request) {
		let origin = req.get('origin') as string;
		return origin.includes('127.0.0.1') || origin === process.env.WEBSITE_HOST as string;
	}

	static getGeo(ip: string) {
		let geo = ['.', '.', '.', '.'], tmp = geoIp.lookup(ip);
		if (tmp && tmp['country']) geo[0] = tmp['country'];
		if (tmp && tmp['region']) geo[1] = tmp['region'];
		if (tmp && tmp['city']) geo[2] = tmp['city'];
		if (tmp && tmp['timezone']) geo[3] = tmp['timezone'];
		return geo.join('; ');
	}

	public static setup() {
		const app = express();
		app.use(cors({origin: process.env.WEBSITE_HOST as string, optionsSuccessStatus: 200}));
		app.use(parser.text());
		/** POST /request {recipient} {hash} */
		app.post('/request', async (req, res) => {
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			const params = req.body ? destr(req.body) : {};
			console.log('request ->', ip, nimiq.checkIp(ip), this.getGeo(ip), params);
			//
			if (!this.isOriginAllowed(req) || !ip || !params || !params.recipient) return res.end('Forbidden'); // Origin not allowed
			if (!nimiq.checkIp(ip)) return res.end('Forbidden'); // IP not allowed
			let recipient = 'NQ26 NKA2 9LFU 3BM2 MX58 N9GU X20C EQ11 NKHS';//params.recipient;
			try {
				let tmp = nimiq.checkRecipient(recipient, true);
				console.log('check Address ->', tmp);
				//
				if (!tmp[0]) return res.end(tmp[1]);
				let row = await User.findOne({
					date: new Date(Date.now()).toLocaleDateString(), recipient: recipient
				});
				console.log('row ->', row);
				//
				let geo = this.getGeo(ip);
				if (!row) {
					row = new User({
						ip: ip, geo: geo, recipient: recipient, hash: nimiq.generateHash(), date: new Date(Date.now()).toLocaleDateString()
					});
					await row.save();
					console.log('save ok', row);
				} else {
					if (row.amount >= 8 || row.times > 100) return res.end('Forbidden');
					if (!row.hash) {
						row.ip = ip;
						row.geo = geo;
						row.hash = nimiq.generateHash();
						await row.save();
					}
				}
				let result: string[] = [], tmpStr = '';
				row.hash.split('').forEach(v => {
					if (tmpStr.length == 24) {
						result.push(tmpStr);
						tmpStr = '';
					}
					tmpStr += (v.charCodeAt(0) + '').padStart(3, '0');
				});
				if (tmpStr) result.push(tmpStr);
				return res.end(result.join('-'));
			} catch (error) {
				await nimiq.log(recipient, error, params);
				return res.end('Forbidden');
			}
		});
		/** POST / {recipient,level} {} */
		app.post('/', async (req, res) => {
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			if (!this.isOriginAllowed(req) || !nimiq.checkIp(ip)) return res.end('Forbidden'); // Origin not allowed
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
			if (!/^[a-zA-Z0-9]{64}$/.test(hashStr) || !params || !params.key || !params.recipient || !nimiq.checkRecipient(params.recipient)[0] || !params.level || parseInt(params.level) < 0 || parseInt(params.level) > 20) {
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
				amount: {$lt: 10},
				last_request_at: {$lte: time}
			});
			if (!user) return res.end('Forbidden'); // Invalid parameters or frequent requests
			let geo = this.getGeo(ip);
			let reward = (await nimiq.pay(user, params.level as number, ip, geo)) as number;
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