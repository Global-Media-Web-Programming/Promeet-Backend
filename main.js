import express from 'express';
import { MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import cors from "cors";

const url =
  'mongodb+srv://red:FqLXCcWUluBe3uMd@cluster0.9uot7b6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(url);

const app = express();
app.use(express.json());
app.use(
    cors({
      origin: "http://localhost:5173", // 프론트엔드 주소
    })
);

let userCollection;
let likeCollection;

async function connectDB() {
  try {
    await client.connect();
    console.log('MongoDB에 연결됨');
    const db = client.db('account');
    userCollection = db.collection('userTable');
    likeCollection = db.collection('likeTable');
  } catch (err) {
    console.error('MongoDB 연결 오류:', err);
  }
}

await connectDB();

// 로그인 및 회원가입 통합 엔드포인트
app.post('/auth/signin', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_REQUIRED_FIELD',
        message: '아이디와 비밀번호는 필수',
      },
    });
  }
  try {
    let user = await userCollection.findOne({ username });
    if (!user) {
      // 사용자 없으면 새로 생성
      const result = await userCollection.insertOne({ username, password });
      return res.status(200).json({
        success: true,
        data: { userId: result.insertedId },
      });
    } else if (user.password === password) {
      // 비밀번호 일치
      return res.status(200).json({
        success: true,
        data: { userId: user._id },
      });
    } else {
      // 비밀번호 불일치
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: '비밀번호가 일치하지 않습니다.',
        },
      });
    }
  } catch (err) {
    console.log('로그인/회원가입 오류:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: '서버에 문제 발생',
      },
    });
  }
});

// 로그아웃
app.post('/auth/logout', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_REQUIRED_FIELD', message: 'userId는 필수' },
    });
  }
  const user = await userCollection.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: '존재하지 않는 사용자' },
    });
  }
  res.status(200).json({ success: true });
});

// 내 정보 조회
app.get('/auth/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const user = await userCollection.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: '존재하지 않는 사용자' },
    });
  }
  res.status(200).json({
    success: true,
    data: {
      userId: user._id,
      name: user.name,
      fixedSchedule: user.fixedSchedule || [],
      promise: user.promises || {},
    },
  });
});

// 좋아요 조회
app.get('/likes', async (req, res) => {
  const { placeId, userId } = req.query;
  if (!placeId || !userId) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_REQUIRED_FIELD', message: 'placeId와 userId는 필수' },
    });
  }

  const isLiked = await likeCollection.findOne({ placeId, userId });
  const likesCount = await likeCollection.countDocuments({ placeId });

  res.status(200).json({
    success: true,
    data: { isLiked: !!isLiked, likesCount },
  });
});

// 좋아요 등록
app.post('/likes', async (req, res) => {
  const { userId, place } = req.body;
  if (!userId || !place) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_REQUIRED_FIELD', message: 'userId와 place는 필수' },
    });
  }

  const user = await userCollection.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: '존재하지 않는 사용자' },
    });
  }

  if (!place.placeId || !place.name || !place.position || !place.address) {
    return res.status(422).json({
      success: false,
      error: { code: 'INVALID_FORMAT', message: 'place의 형식이 잘못됨' },
    });
  }

  const exists = await likeCollection.findOne({ userId, placeId: place.placeId });
  if (exists) {
    return res.status(409).json({
      success: false,
      error: { code: 'ALREADY_LIKED', message: '이미 좋아요한 장소' },
    });
  }

  await likeCollection.insertOne({ userId, ...place });
  res.status(200).json({ success: true });
});

// 좋아요 삭제
app.delete('/likes', async (req, res) => {
  const { userId, placeId } = req.body;
  if (!userId || !placeId) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_REQUIRED_FIELD', message: 'userId와 placeId는 필수' },
    });
  }

  const user = await userCollection.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return res.status(404).json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: '존재하지 않는 사용자' },
    });
  }

  const result = await likeCollection.deleteOne({ userId, placeId });
  if (result.deletedCount === 0) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_LIKED', message: '좋아요 하지 않은 장소' },
    });
  }

  res.status(200).json({ success: true });
});

// 회원가입
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    await userCollection.insertOne({ username, password });
    res.status(201).send('User registered successfully');
  } catch (err) {
    res.status(500).send(err);
  }
});

// 유저 리스트
app.get('/list', async (req, res) => {
  try {
    const users = await userCollection.find({}).toArray();
    res.status(200).json(users);
  } catch (err) {
    res.status(500).send(err);
  }
});

// 서버 시작
const PORT = 4000;
app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT}에서 실행 중`);
});
