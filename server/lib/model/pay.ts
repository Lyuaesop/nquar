import mongo from 'mongoose';

interface Model {
	ip: string,
	hash: string,
	hash_tx: string,
	recipient: string,
	lunas: number,
	reward: number,
	created_at: Date
}

export interface Pay extends Model, mongo.Document {
}

const schema = new mongo.Schema({
	ip: {type: String, required: true, trim: true},
	hash: {type: String, required: true, trim: true},
	hash_tx: {type: String, required: true, trim: true},
	recipient: {type: String, required: true, uppercase: true, trim: true},
	lunas: {type: Number, required: true},
	reward: {type: Number, required: true, min: 0, max: 1},
	created_at: {type: Date, default: Date.now}
}, {versionKey: false});
const table: mongo.Model<Pay> = mongo.model<Pay>('pay', schema);
export default table;