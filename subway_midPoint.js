const fs = require('fs');
const data = JSON.parse(fs.readFileSync('metro_graph.json'));

// 그래프 구성
const graph = {};
data.forEach(({ station, neighbors }) => {
  graph[station] = neighbors.map(({ station: neighbor, time }) => ({
    node: neighbor,
    weight: time
  }));
});

// 우선순위 큐
class PriorityQueue {
  constructor() {
    this.queue = [];
  }
  enqueue(node, priority) {
    this.queue.push({ node, priority });
    this.queue.sort((a, b) => a.priority - b.priority);
  }
  dequeue() {
    return this.queue.shift();
  }
  isEmpty() {
    return this.queue.length === 0;
  }
}

// 다익스트라 + 경로 저장
function dijkstraWithPaths(start) {
  const times = {};
  const prev = {};
  const visited = {};
  const pq = new PriorityQueue();

  Object.keys(graph).forEach(station => {
    times[station] = Infinity;
    prev[station] = null;
  });
  times[start] = 0;
  pq.enqueue(start, 0);

  while (!pq.isEmpty()) {
    const { node: current } = pq.dequeue();
    if (visited[current]) continue;
    visited[current] = true;

    graph[current].forEach(({ node: neighbor, weight }) => {
      const newTime = times[current] + weight;
      if (newTime < times[neighbor]) {
        times[neighbor] = newTime;
        prev[neighbor] = current;
        pq.enqueue(neighbor, newTime);
      }
    });
  }

  function getPath(target) {
    const path = [];
    let node = target;
    while (node) {
      path.unshift(node);
      node = prev[node];
    }
    return path;
  }

  return { times, getPath };
}

// 두 가지 기준 모두 계산
function evaluateCandidates(starts) {
  const results = starts.map(start => {
    const { times, getPath } = dijkstraWithPaths(start);
    return { start, times, getPath };
  });

  const candidates = [];

  Object.keys(graph).forEach(station => {
    const times = results.map(r => r.times[station] ?? Infinity);
    const total = times.reduce((a, b) => a + b, 0);
    const avg = total / times.length;
    const stddev = Math.sqrt(
      times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length
    );
    candidates.push({ station, total, avg, stddev, times });
  });

  const byTotal = [...candidates].sort((a, b) => a.total - b.total)[0];
  const byBalance = [...candidates].sort((a, b) => (a.stddev + a.avg) - (b.stddev + b.avg))[0];

  return { results, byTotal, byBalance };
}

// 출력 함수
function printCandidate(title, candidate, results) {
  console.log(`\n🔹 ${title}`);
  console.log(`🗺️  추천 역: ${candidate.station}`);
  console.log(`⏱️  총 시간(보정 전): ${candidate.total}분`);
  console.log(`📏 평균: ${candidate.avg.toFixed(2)}분, 편차: ${candidate.stddev.toFixed(2)}분`);

  let correctedTotal = 0;

  results.forEach((r, i) => {
    const baseTime = r.times[candidate.station];
    const path = r.getPath(candidate.station);
    const addedTime = Math.floor((path.length - 1) / 2.5); // 2~3역마다 1분 추가
    const correctedTime = baseTime + addedTime;
    correctedTotal += correctedTime;

    console.log(`\n🚩 출발지 ${i + 1}: ${r.start}`);
    console.log(`🕒 이동 시간: ${baseTime}분 + 보정 ${addedTime}분 → 총 ${correctedTime}분`);
    console.log(`➡️  경로: ${path.join(' -> ')}`);
  });

  const avg = correctedTotal / results.length;
  const stddev = Math.sqrt(results.reduce((sum, r, i) => {
    const path = r.getPath(candidate.station);
    const time = r.times[candidate.station];
    const corrected = time + Math.floor((path.length - 1) / 2.5);
    return sum + Math.pow(corrected - avg, 2);
  }, 0) / results.length);

  console.log(`\n✅ 총 보정 시간: ${correctedTotal}분, 평균: ${avg.toFixed(2)}분, 편차: ${stddev.toFixed(2)}분`);
  console.log('\n' + '-'.repeat(50));
}

// 메인 실행
const startPoints = ['장한평_5', '수지구청_S', '약수_3']; // 출발지 자유롭게 수정 가능
const { results, byTotal, byBalance } = evaluateCandidates(startPoints);

printCandidate('1. 총 이동 시간 최소 기준', byTotal, results);
printCandidate('2. 시간 균형(편차 + 평균) 기준', byBalance, results);
