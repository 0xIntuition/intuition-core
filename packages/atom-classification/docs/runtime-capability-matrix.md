# Runtime Capability Matrix

## Runtime targets

- `client`: browser-safe only
- `server`: server runtime only
- `universal`: can run in both runtimes

## Capability and permission rules

| Plugin target | AI capability present | `ai` permission present | Allowed in client engine | Allowed in server engine |
|---|---:|---:|---:|---:|
| `client` | No | No | Yes | No (runtime mismatch) |
| `client` | Yes | Yes/No | No | No |
| `server` | No | No | No (runtime mismatch) | Yes |
| `server` | Yes | Yes | No (runtime mismatch) | Yes |
| `server` | Yes | No | No | No |
| `universal` | No | No | Yes | Yes |
| `universal` | Yes | Yes | No | Yes |
| `universal` | Yes | No | No | No |

## Notes

- Engine runtime compatibility is enforced at registration time.
- AI capabilities without `ai` permission are rejected.
- Client runtime rejects AI-capable plugins even when marked `universal`.
