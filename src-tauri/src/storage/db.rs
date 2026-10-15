//! Local Ephemeral SQLite Database for Sidekick Copilot (SEC-002, SEC-003, REQ-017)
//!
//! Stores active interview session turns, detected questions, and progressive solutions in
//! `~/Library/Application Support/Sidekick/session.db`.
//!
//! Provides the `burn_session` command to immediately truncate WAL checkpoints,
//! drop all session tables, securely remove database files, and purge all session state (SEC-003).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Default SQLite database file name.
pub const DEFAULT_DB_FILENAME: &str = "session.db";

/// Represents an audio transcript turn stored during an active interview session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionTurn {
    pub id: Option<i64>,
    pub turn_id: String,
    pub speaker: String,
    pub transcript: String,
    pub timestamp_ms: i64,
}

/// Represents a detected interview question with extracted summary and quick pointers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuestionRecord {
    pub id: Option<i64>,
    pub question_id: String,
    pub timestamp_ms: i64,
    pub confidence: f64,
    pub raw_transcript: String,
    pub extracted_question: String,
    pub quick_pointers: Vec<String>,
}

/// Represents a progressive 3-stage LLM solution generated for a question.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SolutionRecord {
    pub id: Option<i64>,
    pub question_id: String,
    pub provider: String,
    pub model: String,
    pub stage1_intuition: Option<String>,
    pub stage2_code: Option<String>,
    pub stage3_analysis: Option<String>,
    pub created_at: i64,
}

/// Resolves the file path to the local SQLite session database.
/// Respects `SIDEKICK_DB_PATH` environment variable if set (useful for isolated unit testing).
pub fn get_db_path() -> PathBuf {
    if let Ok(custom) = std::env::var("SIDEKICK_DB_PATH") {
        return PathBuf::from(custom);
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Sidekick")
        .join(DEFAULT_DB_FILENAME)
}

/// Initializes SQLite database tables and enables WAL mode on the given path.
pub fn init_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create database directory {}: {e}", parent.display()))?;
    }

    let conn = Connection::open(path)
        .map_err(|e| format!("Failed to open SQLite database at {}: {e}", path.display()))?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;

         CREATE TABLE IF NOT EXISTS session_turns (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             turn_id TEXT NOT NULL,
             speaker TEXT NOT NULL,
             transcript TEXT NOT NULL,
             timestamp_ms INTEGER NOT NULL
         );

         CREATE TABLE IF NOT EXISTS questions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             question_id TEXT NOT NULL UNIQUE,
             timestamp_ms INTEGER NOT NULL,
             confidence REAL NOT NULL,
             raw_transcript TEXT NOT NULL,
             extracted_question TEXT NOT NULL,
             quick_pointers TEXT
         );

         CREATE TABLE IF NOT EXISTS solutions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             question_id TEXT NOT NULL,
             provider TEXT NOT NULL,
             model TEXT NOT NULL,
             stage1_intuition TEXT,
             stage2_code TEXT,
             stage3_analysis TEXT,
             created_at INTEGER NOT NULL
         );",
    )
    .map_err(|e| format!("Failed to initialize database schema: {e}"))?;

    Ok(conn)
}

/// Opens or creates the default session database.
pub fn open_session_db() -> Result<Connection, String> {
    init_db(&get_db_path())
}

/// Inserts an audio transcription turn into the session database.
pub fn insert_turn(conn: &Connection, turn: &SessionTurn) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO session_turns (turn_id, speaker, transcript, timestamp_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![turn.turn_id, turn.speaker, turn.transcript, turn.timestamp_ms],
    )
    .map_err(|e| format!("Failed to insert session turn: {e}"))?;

    Ok(conn.last_insert_rowid())
}

/// Retrieves all session turns ordered by timestamp.
pub fn get_turns(conn: &Connection) -> Result<Vec<SessionTurn>, String> {
    let mut stmt = conn
        .prepare("SELECT id, turn_id, speaker, transcript, timestamp_ms FROM session_turns ORDER BY timestamp_ms ASC")
        .map_err(|e| format!("Failed to prepare select turns query: {e}"))?;

    let turn_iter = stmt
        .query_map([], |row| {
            Ok(SessionTurn {
                id: Some(row.get(0)?),
                turn_id: row.get(1)?,
                speaker: row.get(2)?,
                transcript: row.get(3)?,
                timestamp_ms: row.get(4)?,
            })
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    let mut turns = Vec::new();
    for turn in turn_iter {
        turns.push(turn.map_err(|e| e.to_string())?);
    }
    Ok(turns)
}

/// Inserts a detected question into the session database.
pub fn insert_question(conn: &Connection, q: &QuestionRecord) -> Result<i64, String> {
    let pointers_json = serde_json::to_string(&q.quick_pointers)
        .map_err(|e| format!("Failed to serialize quick pointers: {e}"))?;

    conn.execute(
        "INSERT OR REPLACE INTO questions (question_id, timestamp_ms, confidence, raw_transcript, extracted_question, quick_pointers)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            q.question_id,
            q.timestamp_ms,
            q.confidence,
            q.raw_transcript,
            q.extracted_question,
            pointers_json
        ],
    )
    .map_err(|e| format!("Failed to insert question: {e}"))?;

    Ok(conn.last_insert_rowid())
}

/// Retrieves all detected questions ordered by timestamp.
pub fn get_questions(conn: &Connection) -> Result<Vec<QuestionRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT id, question_id, timestamp_ms, confidence, raw_transcript, extracted_question, quick_pointers FROM questions ORDER BY timestamp_ms ASC")
        .map_err(|e| format!("Failed to prepare select questions query: {e}"))?;

    let q_iter = stmt
        .query_map([], |row| {
            let pointers_raw: Option<String> = row.get(6)?;
            let quick_pointers = pointers_raw
                .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
                .unwrap_or_default();

            Ok(QuestionRecord {
                id: Some(row.get(0)?),
                question_id: row.get(1)?,
                timestamp_ms: row.get(2)?,
                confidence: row.get(3)?,
                raw_transcript: row.get(4)?,
                extracted_question: row.get(5)?,
                quick_pointers,
            })
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    let mut questions = Vec::new();
    for q in q_iter {
        questions.push(q.map_err(|e| e.to_string())?);
    }
    Ok(questions)
}

/// Inserts a progressive solution into the session database.
pub fn insert_solution(conn: &Connection, s: &SolutionRecord) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO solutions (question_id, provider, model, stage1_intuition, stage2_code, stage3_analysis, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            s.question_id,
            s.provider,
            s.model,
            s.stage1_intuition,
            s.stage2_code,
            s.stage3_analysis,
            s.created_at
        ],
    )
    .map_err(|e| format!("Failed to insert solution: {e}"))?;

    Ok(conn.last_insert_rowid())
}

/// Retrieves solutions associated with a specific question_id.
pub fn get_solutions(conn: &Connection, question_id: &str) -> Result<Vec<SolutionRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT id, question_id, provider, model, stage1_intuition, stage2_code, stage3_analysis, created_at FROM solutions WHERE question_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare select solutions query: {e}"))?;

    let s_iter = stmt
        .query_map(params![question_id], |row| {
            Ok(SolutionRecord {
                id: Some(row.get(0)?),
                question_id: row.get(1)?,
                provider: row.get(2)?,
                model: row.get(3)?,
                stage1_intuition: row.get(4)?,
                stage2_code: row.get(5)?,
                stage3_analysis: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Query failed: {e}"))?;

    let mut solutions = Vec::new();
    for s in s_iter {
        solutions.push(s.map_err(|e| e.to_string())?);
    }
    Ok(solutions)
}

/// Returns counts of (turns, questions, solutions) in the active database.
pub fn count_records(conn: &Connection) -> Result<(usize, usize, usize), String> {
    let turn_count: usize = conn
        .query_row("SELECT count(*) FROM session_turns", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let question_count: usize = conn
        .query_row("SELECT count(*) FROM questions", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let solution_count: usize = conn
        .query_row("SELECT count(*) FROM solutions", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    Ok((turn_count, question_count, solution_count))
}

/// Completely wipes all session records from disk (SEC-002, SEC-003, REQ-017).
/// Checkpoints WAL, drops tables, deletes database files (`.db`, `-wal`, `-shm`),
/// and reinitializes a pristine empty schema.
pub fn burn_session() -> Result<(), String> {
    burn_session_at(&get_db_path())
}

/// Purges session database at a specific path.
pub fn burn_session_at(path: &Path) -> Result<(), String> {
    // 1. If database file exists, checkpoint WAL, drop all tables and vacuum
    if path.exists() {
        if let Ok(conn) = Connection::open(path) {
            let _ = conn.execute_batch(
                "PRAGMA wal_checkpoint(TRUNCATE);
                 DROP TABLE IF EXISTS solutions;
                 DROP TABLE IF EXISTS questions;
                 DROP TABLE IF EXISTS session_turns;
                 VACUUM;",
            );
        }

        // 2. Eradicate primary SQLite database file and WAL/SHM artifacts
        let _ = std::fs::remove_file(path);

        let wal_path = PathBuf::from(format!("{}-wal", path.display()));
        if wal_path.exists() {
            let _ = std::fs::remove_file(wal_path);
        }

        let shm_path = PathBuf::from(format!("{}-shm", path.display()));
        if shm_path.exists() {
            let _ = std::fs::remove_file(shm_path);
        }
    }

    // 3. Reinitialize pristine database schema so subsequent queries have a clean state
    init_db(path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_db(name: &str) -> PathBuf {
        let temp_dir = std::env::temp_dir().join("sidekick_tests");
        let _ = std::fs::create_dir_all(&temp_dir);
        temp_dir.join(format!("{name}_{}.db", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
    }

    #[test]
    fn test_init_and_crud_lifecycle() {
        let db_path = temp_test_db("test_crud");
        let conn = init_db(&db_path).expect("failed to init db");

        // 1. Insert and retrieve turns
        let turn = SessionTurn {
            id: None,
            turn_id: "turn_1".into(),
            speaker: "interviewer".into(),
            transcript: "How would you design a distributed cache?".into(),
            timestamp_ms: 1000,
        };
        let turn_id = insert_turn(&conn, &turn).expect("insert turn");
        assert!(turn_id > 0);

        let turns = get_turns(&conn).expect("get turns");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].turn_id, "turn_1");
        assert_eq!(turns[0].speaker, "interviewer");

        // 2. Insert and retrieve questions
        let question = QuestionRecord {
            id: None,
            question_id: "q_101".into(),
            timestamp_ms: 1500,
            confidence: 0.95,
            raw_transcript: "Can you explain consistent hashing?".into(),
            extracted_question: "Explain consistent hashing".into(),
            quick_pointers: vec!["Ring topology".into(), "Virtual nodes".into()],
        };
        let q_rowid = insert_question(&conn, &question).expect("insert question");
        assert!(q_rowid > 0);

        let questions = get_questions(&conn).expect("get questions");
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question_id, "q_101");
        assert_eq!(questions[0].quick_pointers.len(), 2);
        assert_eq!(questions[0].quick_pointers[0], "Ring topology");

        // 3. Insert and retrieve solutions
        let solution = SolutionRecord {
            id: None,
            question_id: "q_101".into(),
            provider: "anthropic".into(),
            model: "claude-3-5-sonnet".into(),
            stage1_intuition: Some("Consistent hashing distributes keys across a hash ring.".into()),
            stage2_code: Some("class HashRing:\n    pass".into()),
            stage3_analysis: Some("O(log N) lookup using binary search.".into()),
            created_at: 2000,
        };
        let s_rowid = insert_solution(&conn, &solution).expect("insert solution");
        assert!(s_rowid > 0);

        let solutions = get_solutions(&conn, "q_101").expect("get solutions");
        assert_eq!(solutions.len(), 1);
        assert_eq!(solutions[0].provider, "anthropic");
        assert_eq!(solutions[0].model, "claude-3-5-sonnet");

        // Verify count
        let (t_count, q_count, s_count) = count_records(&conn).expect("count records");
        assert_eq!((t_count, q_count, s_count), (1, 1, 1));

        // Clean up
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_burn_session_wipes_all_records() {
        let db_path = temp_test_db("test_burn");
        let conn = init_db(&db_path).expect("init db");

        // Populate records
        insert_turn(
            &conn,
            &SessionTurn {
                id: None,
                turn_id: "t_burn".into(),
                speaker: "candidate".into(),
                transcript: "I would use Redis with LRU eviction".into(),
                timestamp_ms: 3000,
            },
        )
        .unwrap();

        insert_question(
            &conn,
            &QuestionRecord {
                id: None,
                question_id: "q_burn".into(),
                timestamp_ms: 3100,
                confidence: 0.99,
                raw_transcript: "What eviction policy?".into(),
                extracted_question: "Eviction policy".into(),
                quick_pointers: vec!["LRU".into()],
            },
        )
        .unwrap();

        insert_solution(
            &conn,
            &SolutionRecord {
                id: None,
                question_id: "q_burn".into(),
                provider: "openai".into(),
                model: "gpt-4o".into(),
                stage1_intuition: Some("LRU policy".into()),
                stage2_code: None,
                stage3_analysis: None,
                created_at: 3200,
            },
        )
        .unwrap();

        let (t_count, q_count, s_count) = count_records(&conn).unwrap();
        assert_eq!((t_count, q_count, s_count), (1, 1, 1));

        // Drop connection handle before wiping
        drop(conn);

        // Execute burn_session_at
        burn_session_at(&db_path).expect("burn_session_at should succeed");

        // Reconnect and verify records are zeroed (SEC-003, REQ-017)
        let clean_conn = init_db(&db_path).expect("reopen cleaned db");
        let (clean_t, clean_q, clean_s) = count_records(&clean_conn).unwrap();
        assert_eq!(clean_t, 0, "session turns must be 0 after burn");
        assert_eq!(clean_q, 0, "questions must be 0 after burn");
        assert_eq!(clean_s, 0, "solutions must be 0 after burn");

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_burn_session_idempotent() {
        let db_path = temp_test_db("test_burn_idempotent");

        // Burning a non-existent database file should succeed and initialize it cleanly
        burn_session_at(&db_path).expect("first burn on non-existent file succeeds");
        burn_session_at(&db_path).expect("second burn succeeds idempotently");

        let conn = init_db(&db_path).expect("db is valid");
        let (t, q, s) = count_records(&conn).unwrap();
        assert_eq!((t, q, s), (0, 0, 0));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_question_upsert_replaces_existing_question_id() {
        let db_path = temp_test_db("test_upsert");
        let conn = init_db(&db_path).expect("init db");

        let q1 = QuestionRecord {
            id: None,
            question_id: "q_same_id".into(),
            timestamp_ms: 1000,
            confidence: 0.8,
            raw_transcript: "What is Raft?".into(),
            extracted_question: "What is Raft?".into(),
            quick_pointers: vec!["Leader election".into()],
        };
        insert_question(&conn, &q1).unwrap();

        // Update same question_id with higher confidence & new pointers
        let q2 = QuestionRecord {
            id: None,
            question_id: "q_same_id".into(),
            timestamp_ms: 1050,
            confidence: 0.98,
            raw_transcript: "What is Raft consensus algorithm?".into(),
            extracted_question: "Explain Raft consensus".into(),
            quick_pointers: vec!["Leader election".into(), "Log replication".into()],
        };
        insert_question(&conn, &q2).unwrap();

        let questions = get_questions(&conn).unwrap();
        assert_eq!(questions.len(), 1, "upsert must not create duplicate question");
        assert_eq!(questions[0].extracted_question, "Explain Raft consensus");
        assert_eq!(questions[0].quick_pointers.len(), 2);

        let _ = std::fs::remove_file(db_path);
    }
}
