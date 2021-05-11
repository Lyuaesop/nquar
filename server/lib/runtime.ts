import htmlParser from 'node-html-parser';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import geoIp from 'geoip-lite';
import express from 'express';
import https from 'https';
import destr from 'destr';
import cors from 'cors';
import fs from 'fs';
import nimiq from './nimiq';
import User from './model/user';

export default class Runtime {
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
		app.use(cors({
			origin: function (origin, callback) {
				const hostes = process.env.WEBSITE_HOST as string;
				let isAllowed = hostes && origin ? hostes.split(',').includes(origin) : true;
				if (isAllowed) {
					callback(null, true);
					return;
				}
				callback(new Error('Not allowed by CORS'))
			}, optionsSuccessStatus: 200
		}));
		app.use(bodyParser.text());
		/** POST /fetch {} {mapper} */
		app.get('/fetch', async (req, res) => {
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			if (!ip || !nimiq.checkIp(ip)) return res.end('{}'); // IP not allowed
			let blogs: string[] = [], download = '';
			let body = await fetch('https://www.nimiq.com/blog/').then(r => r.text());
			if (body) {
				body = body.replace(/’/g, '\'').replace(/\n/g, '').replace(/<(?:head)([\s\S]*?)<\/(?:head)>/g, '')
				           .replace(/<(?:footer)([\s\S]*?)<\/(?:footer)>/g, '').replace(/<(?:header)([\s\S]*?)<\/(?:header)>/g, '');
				let $body = htmlParser(body);
				let $blogs = $body.querySelectorAll('a.card.clickable');
				if ($blogs && $blogs.length > 0) {
					$blogs.forEach(($e, k) => {
						if (k > 4) return;
						let $img = $e.querySelector('.vts-img>noscript');
						let img = $img ? $img.innerHTML.replace(/\n/g, '').replace('src="/', 'src="https://www.nimiq.com/') : '';
						let title = $e.querySelector('.info-top').innerHTML.replace(/\n/g, '');
						let href = 'https://www.nimiq.com/' + $e.getAttribute('href');
						blogs.push(`<a href="${href}" target="_blank">${img}${title}</a>`);
					});
				}
			}
			body = await fetch('https://trustwallet.com/').then(r => r.text());
			if (body) {
				body = body.replace(/<(?:link)([\s\S]*?)<\/(?:link)>/g, '').replace(/<(?:nav)([\s\S]*?)<\/(?:nav)>/g, '')
				           .replace(/<(?:main)([\s\S]*?)<\/(?:main)>/g, '').replace(/<(?:footer)([\s\S]*?)<\/(?:footer)>/g, '')
				           .replace(/<(?:noscript)([\s\S]*?)<\/(?:noscript)>/g, '');
				let $body = htmlParser(body);
				let $title = $body.querySelector('section.bg-light .align-items-center>.text-lg-left');
				let $icons = $body.querySelectorAll('section.bg-light .align-items-center .download a');
				if ($title && $icons && $icons.length > 0) {
					download = $title.innerHTML.replace(/\n/g, '');
					$icons.forEach($e => {
						$e.setAttribute('target', '_blank');
					});
					download += $body.querySelector('section.bg-light .align-items-center .download').outerHTML.replace(/\n/g, '');
				}
			}
			return res.end(JSON.stringify({blogs: blogs, download: download}));
		});
		/** POST /rank {} {mapper} */
		app.post('/rank', async (req, res) => {
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			if (!ip || !nimiq.checkIp(ip)) return res.end('[]'); // IP not allowed
			let list = await User.aggregate([
				{
					$group: {
						_id: "$recipient", amount: {
							$sum: "$amount"
						}, level: {
							$max: "$max_level"
						}
					}
				}, {$sort: {level: -1, amount: -1}}, {$limit: 8}
			]);
			return res.end(JSON.stringify(list));
		});
		/** POST /request {recipient} {hash} */
		app.post('/request', async (req, res) => {
			let ip = req.headers['x-real-ip'] as string;
			if (!ip) ip = req.ip.replace(/::ffff:/, '');
			let geo = this.getGeo(ip);
			const params = req.body ? destr(req.body) : {};
			if (!ip || !nimiq.checkIp(ip) || !params || !params.recipient) return res.end('Forbidden'); // IP or params not allowed
			const recipient = params.recipient;
			try {
				let tmp = nimiq.checkRecipient(recipient, true);
				if (!tmp[0]) return res.end(tmp[1]);
				let row = await User.findOne({
					date: new Date(Date.now()).toLocaleDateString(), recipient: recipient
				});
				if (!row) {
					row = new User({
						ip: ip, geo: geo, recipient: recipient, hash: nimiq.generateHash(), date: new Date(Date.now()).toLocaleDateString()
					});
					await row.save();
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
			if (!ip || !nimiq.checkIp(ip)) return res.end('Forbidden'); // Ip not allowed
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
			const app2 = express();
			app2.all('*', (req, res) => {
				let host = req.headers.host as string;
				console.log('80 host', host);
				host = host.replace(/\:\d+$/, '');
				res.redirect(307, `https://${host}${req.path}`);
			});
			app2.listen('80');
			return;
		}
		app.listen(process.env.SERVER_PORT as string);
		console.log('Server run OK...');
	}
}