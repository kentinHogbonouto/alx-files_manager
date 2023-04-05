const uuidv4 = require('uuid').v4;
const fs = require('fs');
const { ObjectID } = require('mongodb');
const mime = require('mime-types');
const dbClient = require('../utils/db');
const redisClient = require('../utils/redis');

class FilesController {
  static async postUpload(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { body } = req;

    // Checking if the required items are in body
    if (!body.name) {
      return res.status(400).json({ error: 'Missing name' });
    }
    if (!body.type) {
      return res.status(400).json({ error: 'Missing type' });
    }
    if (!body.data && body.type !== 'folder') {
      return res.status(400).json({ error: 'Missing data' });
    }

    if (body.parentId) {
      const { parentId } = body;
      const id = new ObjectID(parentId);
      const files = await dbClient.db.collection('files');
      const file = await files.findOne({ _id: id });

      if (!file) {
        return res.status(400).json({ error: 'Parent not found' });
      }
      if (file && file.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    // If its a folder the following will be executed
    if (body.type === 'folder') {
      const files = await dbClient.db.collection('files');
      const file = await files.insertOne({
        userId,
        name: body.name,
        type: body.type,
        isPublic: body.isPublic || false,
        parentId: body.parentId || 0,
      });
      const savedFile = file.ops[0];
      return res.status(201).json({
        id: savedFile._id,
        userId: savedFile.userId,
        name: savedFile.name,
        type: savedFile.type,
        isPublic: savedFile.isPublic,
        parentId: savedFile.parentId,
      });
    }
    // If its a file the following will be executed
    if (body.type === 'file' || body.type === 'image') {
      const folderName = '/tmp/files_manager';
      if (!process.env.FOLDER_PATH) {
        if (body.parentId) {
          process.env.FOLDER_PATH = `${folderName}/${body.parentId}`;
        } else {
          process.env.FOLDER_PATH = folderName;
        }
      }
      try {
        if (!fs.existsSync(process.env.FOLDER_PATH)) {
          fs.mkdirSync(process.env.FOLDER_PATH);
        }
      } catch (err) {
        console.log(err);
      }
      // Creating the file
      const absoluteFilePath = `${process.env.FOLDER_PATH}/${uuidv4()}`;
      const decodedData = Buffer.from(body.data, 'base64').toString('ascii');
      fs.appendFile(absoluteFilePath, decodedData, (err) => {
        console.log(err);
      });

      const files = await dbClient.db.collection('files');
      const file = await files.insertOne({
        userId,
        name: body.name,
        type: body.type,
        isPublic: body.isPublic || false,
        parentId: body.parentId || 0,
        localPath: absoluteFilePath,
      });
      const savedFile = file.ops[0];
      return res.status(201).json({
        id: savedFile._id,
        userId: savedFile.userId,
        name: savedFile.name,
        type: savedFile.type,
        isPublic: savedFile.isPublic,
        parentId: savedFile.parentId,
      });
    }
    return null;
  }

  static async getShow(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const files = await dbClient.db.collection('files');
    const file = await files.findOne({ _id: new ObjectID(id) });

    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json(file);
  }

  static async getIndex(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);
    const { parentId = 0, page = 0 } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const users = await dbClient.db.collection('users');
    const user = await users.findOne({ _id: new ObjectID(userId) });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const files = dbClient.db.collection('files');
    let query;
    if (!parentId) {
      query = { userId: user._id };
    } else {
      query = { userId: user._id, parentId: ObjectID(parentId) };
    }

    files.aggregate(
      [
        { $match: query },
        // { $sort: { _id: -1 } },
        {
          $facet: {
            metadata: [{ $count: 'total' }, { $addFields: { page: Number(page) } }],
            data: [{ $skip: 20 * Number(page) }, { $limit: 20 }],
          },
        },
      ],
    ).toArray((err, data) => {
      if (data) {
        const final = data[0].data.map((file) => {
          const temp = {
            ...file,
            id: file._id,
          };
          delete temp._id;
          delete temp.localPath;
          return temp;
        });
        return res.status(200).json(final);
      }

      return res.status(404).json({ error: 'Not found' });
    });

    return [];
  }

  static async getFile(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);
    const { id } = req.params;

    const files = await dbClient.db.collection('files');
    const file = await files.findOne({ _id: new ObjectID(id) });
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!file.isPublic) {
      if (!userId) {
        return res.status(404).json({ error: 'Not found' });
      }

      const users = await dbClient.db.collection('users');
      const user = await users.findOne({ _id: new ObjectID(userId) });
      if (!user) {
        return res.status(404).json({ error: 'Not found' });
      }

      if (file.userId !== user._id.toHexString()) {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    if (file.type === 'folder') {
      return res.status(400).json({ error: "A folder doesn't have content" });
    }

    try {
      const fileName = file.localPath;
      const contentType = mime.contentType(file.name);
      return res.header('Content-Type', contentType).status(200).sendFile(fileName);
    } catch (e) {
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async putPublish(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Getting document id
    const docId = new ObjectID(req.params.id);

    // If no file document is linked to the user and the ID passed as parameter
    // return an error
    const files = await dbClient.db.collection('files');

    const userfile = await files.findOne({ userId });
    if (!userfile) {
      return res.status(404).json({ error: 'Not found' });
    }

    const fileBasedOnId = await files.findOne({ _id: docId });
    if (!fileBasedOnId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const file = await files.findOne({ _id: docId });
    if (!file || file.userId !== userId) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Set isPublic to true
    await files.updateOne({ _id: docId }, { $set: { isPublic: true } });
    const updateFile = await files.findOne({ _id: docId });
    return res.status(200).json({
      id: updateFile._id,
      userId: updateFile.userId,
      name: updateFile.name,
      type: updateFile.type,
      isPublic: updateFile.isPublic,
      parentId: updateFile.parentId,
    });
  }

  static async putUnpublish(req, res) {
    const token = req.headers['x-token'];
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Getting document id
    const docId = new ObjectID(req.params.id);

    // If no file document is linked to the user and the ID passed as parameter
    // return an error
    const files = await dbClient.db.collection('files');

    const userfile = await files.findOne({ userId });
    if (!userfile) {
      return res.status(404).json({ error: 'Not found' });
    }

    const fileBasedOnId = await files.findOne({ _id: docId });
    if (!fileBasedOnId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const file = await files.findOne({ _id: docId });
    if (!file || file.userId !== userId) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Set isPublic to false
    await files.updateOne({ _id: docId }, { $set: { isPublic: false } });
    const updateFile = await files.findOne({ _id: docId });

    return res.status(200).json({
      id: updateFile._id,
      userId: updateFile.userId,
      name: updateFile.name,
      type: updateFile.type,
      isPublic: updateFile.isPublic,
      parentId: updateFile.parentId,
    });
  }
}

module.exports = FilesController;
