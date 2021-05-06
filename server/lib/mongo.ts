import mongo from 'mongoose';

export default class Mongo {
	public static async setup() {
		try {
			await mongo.connect(process.env.DB_LINK as string, {useNewUrlParser: true, useUnifiedTopology: true});
			console.log('Connected with database...', process.env.DB_LINK);
		} catch (error) {
			process.exit();
		}
	}
}