import mongo from 'mongoose';

interface Model {
	ip: string,
	geo: string,
	hash: string,
	hash_tx: string,
	recipient: string,
	lunas: number,
	level: number,
	reward: number,
	created_at: Date
}

export interface Pay extends Model, mongo.Document {
}

const schema = new mongo.Schema({
	ip: {type: String, required: true, trim: true},
	geo: {type: String, required: true, trim: true},
	hash: {type: String, required: true, trim: true},
	hash_tx: {type: String, required: true, trim: true},
	recipient: {type: String, required: true, uppercase: true, trim: true},
	lunas: {type: Number, required: true},
	level: {type: Number, required: true, min: 3, max: 100},
	reward: {type: Number, required: true, min: 0, max: 0.15},
	created_at: {type: Date, default: Date.now}
}, {versionKey: false});
const table: mongo.Model<Pay> = mongo.model<Pay>('pay', schema);
export default table;