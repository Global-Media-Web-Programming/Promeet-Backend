import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';

const PORT = 4000;
const url = 'mongodb+srv://red:FqLXCcWUluBe3uMd@cluster0.9uot7b6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(url);

const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://localhost:5173' }));

let db, userCollection, likesCollection, promisesCollection;

async function connectDB() {
    await client.connect();
    db = client.db('account');
    userCollection = db.collection('userTable');
    likesCollection = db.collection('likeTable');
    promisesCollection = db.collection('promiseTable');
    console.log('MongoDB에 연결됨');
}
await connectDB();

// 공통 에러 응답 함수
function sendError(res, code, message, status = 400) {
    return res.status(status).json({ success: false, error: { code, message } });
}

// 내 정보 조회
app.get('/user/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!userId) return sendError(res, 'MISSING_REQUIRED_PARAM', '필수 URL 경로 파라미터 누락', 404);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        res.status(200).json({
            success: true,
            data: {
                userId: user._id.toString(),
                name: user.name,
                fixedSchedule: user.fixedSchedules || [],
                promises: {
                    create: user.promise?.create || [],
                    join: user.promise?.join || []
                }
            }
        });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 좋아요 정보 조회
app.get('/likes', async (req, res) => {
    const { promiseId, placeId, userId } = req.query;
    if (!promiseId || !placeId || !userId)
        return sendError(res, 'MISSING_REQUIRED_PARAM', '필수 쿼리 파라미터 누락', 404);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const isLiked = !!(await likesCollection.findOne({ promiseId, placeId, userId }));
        const likesCount = await likesCollection.countDocuments({ promiseId, placeId });
        res.status(200).json({ success: true, data: { isLiked, likesCount } });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 약속 정보 조회
app.get('/promises/:promiseId', async (req, res) => {
    const { promiseId } = req.params;
    const { userId } = req.query;
    if (!promiseId || !userId)
        return sendError(res, 'MISSING_REQUIRED_PARAM', '필수 URL 경로 파라미터 누락', 404);

    try {
        // 약속 정보 조회
        const promise = await promisesCollection.findOne({ _id: new ObjectId(promiseId) });
        if (!promise) return sendError(res, 'PROMISE_NOT_FOUND', '존재하지 않는 약속', 404);

        // 멤버 정보 조회
        const memberIds = promise.memberIds || [];
        const membersRaw = await userCollection.find({ _id: { $in: memberIds.map(id => new ObjectId(id)) } }).toArray();

        // 좋아요 정보 집계
        const likedPlacesRaw = await likesCollection.aggregate([
            { $match: { promiseId } },
            { $group: {
                    _id: '$placeId',
                    userIds: { $addToSet: '$userId' },
                    likesCount: { $sum: 1 },
                    place: { $first: '$place' }
                }},
            { $sort: { likesCount: -1 } }
        ]).toArray();

        // 멤버별 제출/좋아요 여부
        const creatorId = promise.creatorId;
        const likedPlaceUserMap = {};
        likedPlacesRaw.forEach(lp => {
            lp.userIds.forEach(uid => {
                likedPlaceUserMap[uid] = true;
            });
        });

        const members = membersRaw.map(m => {
            const isCreator = m._id.toString() === creatorId;
            const hasSubmittedData = !!(m.nearestStation && m.availableTimes);
            const hasLikedPlace = !isCreator && !!likedPlaceUserMap[m._id.toString()];
            return {
                name: m.name,
                userId: m._id.toString(),
                hasSubmittedData,
                nearestStation: m.nearestStation,
                availableTimes: m.availableTimes,
                ...(isCreator ? {} : { hasLikedPlace })
            };
        });

        // 모든 멤버 제출 여부
        const isAllMembersSubmit = members.every(m => m.hasSubmittedData);

        // 모든 멤버(생성자 제외)가 좋아요 제출했는지
        const allMembersLiked = members
            .filter(m => m.userId !== creatorId)
            .every(m => m.hasLikedPlace);

        // canFix 조건
        const canFix = (
            userId === creatorId &&
            isAllMembersSubmit &&
            allMembersLiked &&
            !promise.isFixed
        );

        // likedPlaces 변환
        const likedPlaces = likedPlacesRaw.map(lp => ({
            userIds: lp.userIds,
            likesCount: lp.likesCount,
            place: lp.place
        }));

        // fixedTime, centerStation, routes 등은 예시/임시 데이터
        // 실제 로직 필요시 별도 함수로 분리
        const fixedTime = promise.fixedTime || [];
        const centerStation = promise.centerStation || null;
        const routes = (membersRaw || []).map(m => ({
            name: m.name,
            userId: m._id.toString(),
            route: [] // 실제 경로 계산 필요
        }));

        res.status(200).json({
            success: true,
            data: {
                creatorId,
                members,
                title: promise.title,
                description: promise.description,
                isAllMembersSubmit,
                fixedTime,
                centerStation,
                routes,
                likedPlaces,
                fixedPlace: promise.fixedPlace || null,
                canFix,
                isFixed: !!promise.isFixed
            }
        });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 약속 생성자 정보 조회
app.get('/promises/:promiseId/summary', async (req, res) => {
    const { promiseId } = req.params;
    if (!promiseId)
        return sendError(res, 'MISSING_REQUIRED_PARAM', '필수 URL 경로 파라미터 누락', 404);
    try {
        const promise = await promisesCollection.findOne({ _id: new ObjectId(promiseId) });
        if (!promise)
            return sendError(res, 'PROMISE_NOT_FOUND', '존재하지 않는 약속', 404);
        const creator = await userCollection.findOne({ _id: new ObjectId(promise.creatorId) });
        if (!creator)
            return sendError(res, 'USER_NOT_FOUND', '생성자 정보 없음', 404);
        res.status(200).json({
            success: true,
            data: {
                creatorId: creator._id.toString(),
                creatorName: creator.name,
                title: promise.title,
                description: promise.description
            }
        });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 로그인
app.post('/auth/signin', async (req, res) => {
    const { name, password, promiseId } = req.body;
    if (!name || !password)
        return sendError(res, 'MISSING_REQUIRED_FIELD', '이름과 비밀번호는 필수');
    try {
        let user = await userCollection.findOne({ name });
        if (!user) {
            const result = await userCollection.insertOne({ name, password, promise: { join: [] } });
            user = await userCollection.findOne({ _id: result.insertedId });
        } else if (user.password !== password) {
            return sendError(res, 'INVALID_PASSWORD', '비밀번호가 일치하지 않습니다');
        }
        if (promiseId) {
            await userCollection.updateOne(
                { _id: user._id },
                { $addToSet: { 'promise.join': promiseId } }
            );
        }
        res.status(200).json({ success: true, data: { userId: user._id } });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 로그아웃
app.post('/auth/logout', async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return sendError(res, 'MISSING_REQUIRED_FIELD', 'userId는 필수');
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        res.status(200).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 회원가입
app.post('/auth/signup', async (req, res) => {
    const { name, password } = req.body;
    if (!name || !password)
        return sendError(res, 'MISSING_REQUIRED_FIELD', '이름과 비밀번호는 필수');
    try {
        const exists = await userCollection.findOne({ name });
        if (exists)
            return sendError(res, 'USER_EXISTS', '이미 존재하는 사용자', 409);
        const result = await userCollection.insertOne({
            name,
            password,
            promise: { create: [], join: [] },
            fixedSchedules: []
        });
        res.status(201).json({
            success: true,
            data: { userId: result.insertedId.toString(), name }
        });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 고정 스케줄 등록
app.post('/user/:userId/fixed-schedules', async (req, res) => {
    const { userId } = req.params;
    const { fixedSchedules } = req.body;
    if (!userId || !fixedSchedules)
        return sendError(res, 'MISSING_REQUIRED_FIELD', 'userId와 fixedSchedules는 필수');
    if (!Array.isArray(fixedSchedules) || fixedSchedules.some(s =>
        !s.id || !s.date || !s.day || !s.startTime || !s.endTime
    )) return sendError(res, 'INVALID_FORMAT', 'fixedSchedule의 형식이 잘못됨', 422);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const existing = user.fixedSchedules || [];
        for (const newSch of fixedSchedules) {
            if (existing.some(e =>
                e.date === newSch.date &&
                e.startTime === newSch.startTime &&
                e.endTime === newSch.endTime
            )) {
                return sendError(res, 'SCHEDULE_CONFLICT', '이미 등록된 고정 스케줄과 중복됨', 409);
            }
        }
        await userCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $push: { fixedSchedules: { $each: fixedSchedules } } }
        );
        res.status(201).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 고정 스케줄 삭제
app.delete('/user/:userId/fixed-schedules/:scheduleId', async (req, res) => {
    const { userId, scheduleId } = req.params;
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const existing = user.fixedSchedules || [];
        if (!existing.some(s => s.id === scheduleId))
            return sendError(res, 'SCHEDULE_NOT_FOUND', '존재하지 않는 스케줄', 404);
        await userCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $pull: { fixedSchedules: { id: scheduleId } } }
        );
        res.status(200).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 고정 스케줄 수정
app.patch('/user/:userId/fixed-schedules/:scheduleId', async (req, res) => {
    const { userId, scheduleId } = req.params;
    const { fixedSchedule } = req.body;
    if (!userId || !scheduleId || !fixedSchedule)
        return sendError(res, 'MISSING_REQUIRED_FIELD', '필수 필드 누락');
    if (!fixedSchedule.id || !fixedSchedule.day || !fixedSchedule.startTime || !fixedSchedule.endTime)
        return sendError(res, 'INVALID_FORMAT', 'fixedSchedule의 형식이 잘못됨', 422);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const existing = user.fixedSchedules || [];
        const idx = existing.findIndex(s => s.id === scheduleId);
        if (idx === -1)
            return sendError(res, 'SCHEDULE_NOT_FOUND', '존재하지 않는 스케줄', 404);
        if (existing.some((s, i) =>
            i !== idx &&
            s.day === fixedSchedule.day &&
            s.startTime === fixedSchedule.startTime &&
            s.endTime === fixedSchedule.endTime
        )) {
            return sendError(res, 'SCHEDULE_CONFLICT', '이미 등록된 고정 스케줄과 중복됨', 409);
        }
        await userCollection.updateOne(
            { _id: new ObjectId(userId), "fixedSchedules.id": scheduleId },
            { $set: { "fixedSchedules.$": fixedSchedule } }
        );
        res.status(200).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 약속 생성
app.post('/promises', async (req, res) => {
    const {
        creatorId, promiseName, promiseDescription,
        memberCnt, nearestStation, availableTimes
    } = req.body;
    if (!creatorId || !promiseName || !promiseDescription || !memberCnt || !nearestStation || !availableTimes)
        return sendError(res, 'MISSING_REQUIRED_FIELD', '필수 필드 누락');
    if (!Array.isArray(availableTimes) || availableTimes.some(s =>
        !s.id || !s.date || !s.day || !s.startTime || !s.endTime
    )) return sendError(res, 'INVALID_FORMAT', '약속 정보 형식이 잘못됨', 422);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(creatorId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const promiseDoc = {
            creatorId,
            title: promiseName,
            description: promiseDescription,
            memberCnt,
            memberIds: [creatorId],
            nearestStation,
            availableTimes,
            createdAt: new Date()
        };
        const result = await promisesCollection.insertOne(promiseDoc);
        await userCollection.updateOne(
            { _id: new ObjectId(creatorId) },
            {
                $addToSet: { 'promise.create': result.insertedId.toString() },
                $set: {
                    nearestStation,
                    availableTimes,
                    hasSubmitted: true
                }
            }
        );
        res.status(201).json({
            success: true,
            data: { promiseId: result.insertedId.toString() }
        });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 좋아요 등록
app.post('/likes', async (req, res) => {
    const { promiseId, place, userId } = req.body;
    if (!promiseId || !place || !userId)
        return sendError(res, 'MISSING_REQUIRED_FIELD', 'userId와 place는 필수');
    if (!place.placeId || !place.type || !place.name || !place.position || !place.address)
        return sendError(res, 'INVALID_FORMAT', 'place의 형식이 잘못됨', 422);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const already = await likesCollection.findOne({ promiseId, placeId: place.placeId, userId });
        if (already)
            return sendError(res, 'ALREADY_LIKED', '이미 좋아요한 장소', 409);
        await likesCollection.insertOne({
            promiseId,
            placeId: place.placeId,
            userId,
            place,
            createdAt: new Date()
        });
        res.status(200).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 좋아요 삭제
app.delete('/likes', async (req, res) => {
    const { promiseId, placeId, userId } = req.body;
    if (!userId || !placeId)
        return sendError(res, 'MISSING_REQUIRED_FIELD', 'userId와 placeId는 필수');
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const like = await likesCollection.findOne({ promiseId, placeId, userId });
        if (!like)
            return sendError(res, 'NOT_LIKED', '좋아요 되지 않은 장소', 404);
        await likesCollection.deleteOne({ _id: like._id });
        res.status(200).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 약속 참여
app.patch('/promises/:promiseId/join/:userId', async (req, res) => {
    const { promiseId, userId } = req.params;
    const { nearestStation, availableTimes } = req.body;
    if (!promiseId || !userId || !nearestStation || !availableTimes)
        return sendError(res, 'MISSING_REQUIRED_FIELD', '필수 필드 누락');
    if (!Array.isArray(availableTimes) || availableTimes.some(s =>
        !s.id || !s.date || !s.day || !s.startTime || !s.endTime
    )) return sendError(res, 'INVALID_FORMAT', '약속 정보 형식이 잘못됨', 422);
    try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return sendError(res, 'USER_NOT_FOUND', '존재하지 않는 사용자', 404);
        const promise = await promisesCollection.findOne({ _id: new ObjectId(promiseId) });
        if (!promise) return sendError(res, 'PROMISE_NOT_FOUND', '존재하지 않는 약속', 404);
        if (!promise.memberIds.includes(userId)) {
            await promisesCollection.updateOne(
                { _id: new ObjectId(promiseId) },
                { $addToSet: { memberIds: userId } }
            );
        }
        await userCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { nearestStation, availableTimes } }
        );
        res.status(200).json({ success: true, times: availableTimes });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

// 약속 확정
app.patch('/promises/:promiseId/finalize', async (req, res) => {
    const { promiseId } = req.params;
    const { userId, place } = req.body;
    if (!promiseId || !userId || !place)
        return sendError(res, 'MISSING_REQUIRED_FIELD', '필수 필드 누락');
    try {
        const promise = await promisesCollection.findOne({ _id: new ObjectId(promiseId) });
        if (!promise) return sendError(res, 'PROMISE_NOT_FOUND', '존재하지 않는 약속', 404);
        const members = await userCollection.find({ _id: { $in: promise.memberIds.map(id => new ObjectId(id)) } }).toArray();
        const isAllMembersSubmit = members.every(m => m.nearestStation && m.availableTimes);
        const likedPlacesRaw = await likesCollection.aggregate([
            { $match: { promiseId } },
            { $group: { _id: '$placeId', userIds: { $addToSet: '$userId' } } }
        ]).toArray();
        const likedUserIds = new Set();
        likedPlacesRaw.forEach(lp => lp.userIds.forEach(uid => likedUserIds.add(uid)));
        const canFix = (
            userId === promise.creatorId &&
            isAllMembersSubmit &&
            members
                .filter(m => m._id.toString() !== promise.creatorId)
                .every(m => Array.from(likedUserIds).includes(m._id.toString()))
        );
        if (!canFix)
            return sendError(res, 'CANNOT_FIX_PROMISE', '약속을 확정할 수 있는 조건이 충족되지 않았거나 권한이 없음', 403);
        await promisesCollection.updateOne(
            { _id: new ObjectId(promiseId) },
            { $set: { fixedPlace: place, isFixed: true, canFix: false } }
        );
        res.status(200).json({ success: true });
    } catch {
        sendError(res, 'SERVER_ERROR', '서버에 문제 발생', 500);
    }
});

app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT}에서 실행 중`);
});
