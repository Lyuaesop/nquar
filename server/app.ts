import envs from 'dotenv';
import mongo from './lib/mongo';
import nimiq from './lib/nimiq';
import runtime from './lib/runtime';

envs.config();
mongo.setup().then(() => {
	console.log('MongoDB run OK...');
	nimiq.setup().then(() => {
		console.log('Nimiq run OK...');
		runtime.setup();
	});
});