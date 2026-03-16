import fs from "fs";
import path from "path";
// ---------------------------------------------------------------------------
// BM25 (simplified — over candidate set only)
// ---------------------------------------------------------------------------
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
}
function computeBm25Scores(query, candidates) {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0 || candidates.length === 0) {
        return new Map(candidates.map((c) => [c.chunk.id, 0]));
    }
    const k1 = 1.5;
    const b = 0.75;
    // Compute document frequencies
    const df = new Map();
    const docLengths = [];
    const tokenizedDocs = [];
    for (const { chunk } of candidates) {
        const tokens = tokenize(chunk.content);
        tokenizedDocs.push(tokens);
        docLengths.push(tokens.length);
        const uniq = new Set(tokens);
        for (const term of uniq) {
            df.set(term, (df.get(term) ?? 0) + 1);
        }
    }
    const N = candidates.length;
    const avgdl = docLengths.reduce((a, b) => a + b, 0) / N;
    const scores = new Map();
    for (let i = 0; i < candidates.length; i++) {
        const tokens = tokenizedDocs[i];
        const dl = docLengths[i];
        const tf = new Map();
        for (const t of tokens)
            tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const term of queryTerms) {
            const f = tf.get(term) ?? 0;
            const dft = df.get(term) ?? 0;
            if (dft === 0)
                continue;
            const idf = Math.log((N - dft + 0.5) / (dft + 0.5) + 1);
            const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl)));
            score += idf * tfNorm;
        }
        scores.set(candidates[i].chunk.id, score);
    }
    return scores;
}
function normalizeScores(scores) {
    if (scores.size === 0)
        return scores;
    const vals = Array.from(scores.values());
    const max = Math.max(...vals);
    if (max === 0)
        return new Map(Array.from(scores.entries()).map(([k]) => [k, 0]));
    return new Map(Array.from(scores.entries()).map(([k, v]) => [k, v / max]));
}
// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------
export async function semanticSearch(index, query, topK, filter) {
    // 1. Embed the query
    const queryEmbedding = await index.embed(query);
    // 2. Get top topK * 3 semantic candidates
    const candidates = await index.search(queryEmbedding, topK * 3);
    if (candidates.length === 0)
        return [];
    // 3. Normalize semantic scores (already cosine [-1,1], shift to [0,1])
    const normSemantic = new Map();
    let minSim = Infinity, maxSim = -Infinity;
    for (const { chunk, similarity } of candidates) {
        if (similarity < minSim)
            minSim = similarity;
        if (similarity > maxSim)
            maxSim = similarity;
        normSemantic.set(chunk.id, similarity);
    }
    // Normalize to [0,1]
    const simRange = maxSim - minSim;
    for (const [id, sim] of normSemantic) {
        normSemantic.set(id, simRange > 0 ? (sim - minSim) / simRange : 1);
    }
    // 4. BM25 scoring on candidates
    const rawBm25 = computeBm25Scores(query, candidates);
    const normBm25 = normalizeScores(rawBm25);
    // 5. Combine scores
    const results = candidates.map(({ chunk, similarity }) => {
        const semanticScore = normSemantic.get(chunk.id) ?? 0;
        const bm25Score = normBm25.get(chunk.id) ?? 0;
        let finalScore = 0.7 * semanticScore + 0.3 * bm25Score;
        // 6. Boost guiding principles and constraints
        if ((chunk.artifactType === "principle" || chunk.artifactType === "constraint") &&
            similarity > 0.3) {
            finalScore = Math.min(1, finalScore + 0.1);
        }
        return { chunk, semanticScore: similarity, bm25Score, finalScore };
    });
    // 7. Apply filter
    let filtered = results;
    if (filter?.type) {
        filtered = filtered.filter((r) => r.chunk.artifactType === filter.type);
    }
    if (filter?.domain) {
        filtered = filtered.filter((r) => r.chunk.domain === filter.domain);
    }
    // 8. Sort by finalScore descending, return topK
    filtered.sort((a, b) => b.finalScore - a.finalScore);
    return filtered.slice(0, topK);
}
// ---------------------------------------------------------------------------
// Query logging
// ---------------------------------------------------------------------------
export function logQuery(artifactDir, query, results, requestingAgent) {
    const logDir = path.join(artifactDir, ".ideate-index");
    const logPath = path.join(logDir, "query-log.jsonl");
    const entry = {
        timestamp: new Date().toISOString(),
        query,
        requesting_agent: requestingAgent ?? null,
        results: results.map((r) => ({
            chunk_id: r.chunk.id,
            file_path: r.chunk.filePath,
            section_path: r.chunk.sectionPath,
            semantic_score: r.semanticScore,
            bm25_score: r.bm25Score,
            final_score: r.finalScore,
        })),
    };
    try {
        fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
    }
    catch {
        // Non-fatal — logging failure should not break search
    }
}
//# sourceMappingURL=retrieval.js.map