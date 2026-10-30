# Export failure feedback

October28,2026. Markdown read rejection closed Export menu without a download or alert and emitted uncaught rejection. Sidebar now awaits JSON/Markdown/ICS export work, guards duplicate launches, shows pending and named failure with instruction to choose same format again. Formats/filenames/JSON attachment warning unchanged. Download event is not proof of saving a file to disk; no such success claim added.

Six1440/390/320light/dark groups test all three rejected read paths/retry/pending guard/download-event filenames. Checked-exit build passes.390light/320dark pixels inspected: wrapped error near Export, no overlap/overflow. Desktop sidebar and mobile More sheet retain mounted state; closing sheet hides feedback but reopening shows it. No persistence across page reload.

DownloadFile implementation, file contents, JSON attachment exclusion and exporter mapping unchanged. User browser cancellation/disk failure not detected. This candidate handles preparation failures only, not downstream browser save completion.
