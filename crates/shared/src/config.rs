use std::env;

use crate::errors::{IndexerError, Result};

/// Database configuration
#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout_sec: u64,
}

impl DatabaseConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            url: env::var("DATABASE_URL")
                .map_err(|_| IndexerError::Config("DATABASE_URL not set".to_string()))?,
            max_connections: env::var("DB_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "20".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid DB_MAX_CONNECTIONS".to_string()))?,
            min_connections: env::var("DB_MIN_CONNECTIONS")
                .unwrap_or_else(|_| "2".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid DB_MIN_CONNECTIONS".to_string()))?,
            acquire_timeout_sec: env::var("DB_ACQUIRE_TIMEOUT_SEC")
                .unwrap_or_else(|_| "30".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid DB_ACQUIRE_TIMEOUT_SEC".to_string()))?,
        })
    }
}

/// Redis configuration
#[derive(Debug, Clone)]
pub struct RedisConfig {
    pub url: String,
    pub leader_key: String,
    pub leader_ttl_sec: u64,
}

impl RedisConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            url: env::var("REDIS_URL")
                .map_err(|_| IndexerError::Config("REDIS_URL not set".to_string()))?,
            leader_key: env::var("REDIS_LEADER_KEY")
                .unwrap_or_else(|_| "ingestion_leader_lock".to_string()),
            leader_ttl_sec: env::var("REDIS_LEADER_TTL_SEC")
                .unwrap_or_else(|_| "15".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid REDIS_LEADER_TTL_SEC".to_string()))?,
        })
    }
}

/// Blockchain configuration
#[derive(Debug, Clone)]
pub struct BlockchainConfig {
    pub rpc_endpoint: String,
    pub contract_address: String,
    pub start_block: u64,
    pub chain_id: u64,
}

impl BlockchainConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            rpc_endpoint: env::var("INTUITION_RPC_URL")
                .or_else(|_| env::var("RPC_ENDPOINT"))
                .map_err(|_| {
                    IndexerError::Config("INTUITION_RPC_URL (or RPC_ENDPOINT) not set".to_string())
                })?,
            contract_address: env::var("MULTIVAULT_CONTRACT_ADDRESS").map_err(|_| {
                IndexerError::Config("MULTIVAULT_CONTRACT_ADDRESS not set".to_string())
            })?,
            start_block: env::var("MULTIVAULT_START_BLOCK")
                .unwrap_or_else(|_| "0".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid MULTIVAULT_START_BLOCK".to_string()))?,
            chain_id: env::var("CHAIN_ID")
                .unwrap_or_else(|_| "1".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid CHAIN_ID".to_string()))?,
        })
    }
}

/// Server configuration (metrics, health endpoints)
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub metrics_port: u16,
    pub health_port: u16,
}

impl ServerConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            metrics_port: env::var("METRICS_PORT")
                .unwrap_or_else(|_| "9091".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid METRICS_PORT".to_string()))?,
            health_port: env::var("HEALTH_PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .map_err(|_| IndexerError::Config("Invalid HEALTH_PORT".to_string()))?,
        })
    }
}

/// Load environment variables from .env file
pub fn load_env() -> Result<()> {
    dotenvy::dotenv().ok();
    Ok(())
}

/// Get required environment variable
pub fn get_env(key: &str) -> Result<String> {
    env::var(key).map_err(|_| IndexerError::Config(format!("{} not set", key)))
}

/// Get optional environment variable
pub fn get_env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Get environment variable as type T
pub fn get_env_as<T: std::str::FromStr>(key: &str) -> Result<T>
where
    T::Err: std::fmt::Display,
{
    get_env(key)?
        .parse()
        .map_err(|e| IndexerError::Config(format!("Invalid {}: {}", key, e)))
}
