import mongo from 'mongoose';

interface Model {
	ip: string,
	geo: string,
	date: string,
	times: number,
	amount: number,
	max_level: number,
	hash: string,
	recipient: string,
	last_request_at: Date,
	created_at: Date,
}

export interface User extends Model, mongo.Document {
}

const schema = new mongo.Schema({
	ip: {type: String, required: true, trim: true},
	geo: {type: String, required: true, trim: true},
	date: {type: String, required: true, trim: true},
	times: {type: Number, default: 0, min: 0},
	amount: {type: Number, default: 0, min: 0, max: 20},
	max_level: {type: Number, default: 0, min: 0},
	hash: {type: String, default: '', trim: true},
	recipient: {type: String, required: true, uppercase: true, trim: true},
	last_request_at: {type: Date, default: Date.now},
	created_at: {type: Date, default: Date.now}
}, {versionKey: false});
const table: mongo.Model<User> = mongo.model<User>('user', schema);
export default table;