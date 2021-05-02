import mongo from 'mongoose';

interface Model {
	recipient: string,
	message: string,
	params: object,
	created_at: Date
}

export interface Log extends Model, mongo.Document {
}

const schema = new mongo.Schema({
	recipient: {type: String, default: '-', uppercase: true, trim: true},
	message: {type: String, required: true, trim: true},
	params: {type: Object, default: {}},
	created_at: {type: Date, default: Date.now}
}, {versionKey: false});
const table: mongo.Model<Log> = mongo.model<Log>('log', schema);
export default table;