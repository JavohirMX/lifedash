import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_fd, _path = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["SYNC_DB"] = _path
os.environ["SYNC_OPEN_REGISTRATION"] = "1"
