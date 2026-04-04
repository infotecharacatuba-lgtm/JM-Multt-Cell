"""
FinControl Pro - Backend FastAPI + SQLite multi-tenant.
Cada empresa possui seu próprio banco.
"""

import asyncio
import io
import os
import tempfile
import sqlite3
import zipfile
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta
from typing import Optional


from fastapi import Depends, FastAPI, Form, Header, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from openpyxl import Workbook
from passlib.context import CryptContext
from pydantic import BaseModel

SECRET_KEY = "fincontrol-secret-2024-sqlite"
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12
MASTER_DB = "fincontrol_master.db"
DATA_DIR = "data"
DEFAULT_COMPANY_NAME = "JM MULT CELL"
DEFAULT_COMPANY_SLUG = "jm-mult-cell"
DEFAULT_ADMIN_NAME = "Administrador JM MULT CELL"
DEFAULT_ADMIN_USER = "jm-mult-cell"
DEFAULT_ADMIN_PASS = "jm-mult-cell!2026@"

os.makedirs(DATA_DIR, exist_ok=True)

pwd_ctx = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")


def db_path_for(slug: str) -> str:
  tenant_path = os.path.join(DATA_DIR, f"{slug}.db")
  if os.path.exists(tenant_path):
    return tenant_path
  return tenant_path


@contextmanager
def get_master_db():
  conn = sqlite3.connect(MASTER_DB)
  conn.row_factory = sqlite3.Row
  conn.execute("PRAGMA foreign_keys = ON")
  conn.execute("PRAGMA journal_mode = WAL")
  try:
    yield conn
    conn.commit()
  except Exception:
    conn.rollback()
    raise
  finally:
    conn.close()


@contextmanager
def get_tenant_db(slug: str):
  conn = sqlite3.connect(db_path_for(slug))
  conn.row_factory = sqlite3.Row
  conn.execute("PRAGMA foreign_keys = ON")
  conn.execute("PRAGMA journal_mode = WAL")
  try:
    yield conn
    conn.commit()
  except Exception:
    conn.rollback()
    raise
  finally:
    conn.close()


def row_to_dict(row):
  return dict(row) if row else None


def rows_to_list(rows):
  return [dict(row) for row in rows]


def init_master_db():
  with get_master_db() as conn:
    conn.executescript(
      """
      CREATE TABLE IF NOT EXISTS empresas (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          nome       TEXT NOT NULL,
          slug       TEXT UNIQUE NOT NULL,
          ativo      INTEGER NOT NULL DEFAULT 1,
          criado_em  TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS sistema_controle (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL
      );
      """
    )


def init_tenant_db(slug: str):
  with get_tenant_db(slug) as conn:
    conn.executescript(
      """
      CREATE TABLE IF NOT EXISTS usuarios (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          username  TEXT UNIQUE NOT NULL,
          senha     TEXT NOT NULL,
          nome      TEXT NOT NULL,
          role      TEXT NOT NULL DEFAULT 'operador',
          ativo     INTEGER NOT NULL DEFAULT 1,
          criado_em TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS categorias_financeiro (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          nome  TEXT NOT NULL,
          tipo  TEXT NOT NULL CHECK(tipo IN ('receita','despesa'))
      );

      CREATE TABLE IF NOT EXISTS clientes (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          nome      TEXT NOT NULL,
          cpf_cnpj  TEXT,
          telefone  TEXT,
          email     TEXT,
          endereco  TEXT,
          cidade    TEXT,
          uf        TEXT,
          cep       TEXT,
          criado_em TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS fornecedores (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          razao_social TEXT NOT NULL,
          cnpj         TEXT,
          contato      TEXT,
          email        TEXT,
          telefone     TEXT,
          endereco     TEXT,
          cidade       TEXT,
          uf           TEXT,
          criado_em    TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS transacoes (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo          TEXT NOT NULL CHECK(tipo IN ('receita','despesa')),
          descricao     TEXT NOT NULL,
          valor         REAL NOT NULL,
          data          TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'pago' CHECK(status IN ('pago','pendente','cancelado')),
          categoria_id  INTEGER REFERENCES categorias_financeiro(id),
          cliente_id    INTEGER REFERENCES clientes(id),
          fornecedor_id INTEGER REFERENCES fornecedores(id),
          observacao    TEXT,
          usuario_id    INTEGER REFERENCES usuarios(id),
          criado_em     TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS produtos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo         TEXT UNIQUE NOT NULL,
          nome           TEXT NOT NULL,
          descricao      TEXT,
          estoque_atual  REAL NOT NULL DEFAULT 0,
          estoque_minimo REAL NOT NULL DEFAULT 0,
          custo          REAL NOT NULL DEFAULT 0,
          preco_venda    REAL NOT NULL DEFAULT 0,
          unidade        TEXT NOT NULL DEFAULT 'un',
          categoria_id   INTEGER,
          ativo          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS movimentos_estoque (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id     INTEGER NOT NULL REFERENCES produtos(id),
          tipo           TEXT NOT NULL CHECK(tipo IN ('entrada','saida','ajuste')),
          quantidade     REAL NOT NULL,
          custo_unitario REAL NOT NULL DEFAULT 0,
          observacao     TEXT,
          usuario_id     INTEGER REFERENCES usuarios(id),
          data_hora      TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario_id INTEGER REFERENCES usuarios(id),
          username   TEXT,
          acao       TEXT NOT NULL,
          tabela     TEXT,
          detalhe    TEXT,
          data_hora  TEXT DEFAULT (datetime('now','localtime'))
      );
      """
    )

    if conn.execute("SELECT COUNT(*) FROM categorias_financeiro").fetchone()[0] == 0:
      conn.executemany(
        "INSERT INTO categorias_financeiro (nome, tipo) VALUES (?, ?)",
        [
          ("Vendas", "receita"),
          ("Serviços", "receita"),
          ("Outras Receitas", "receita"),
          ("Fornecedores", "despesa"),
          ("Marketing", "despesa"),
          ("Impostos", "despesa"),
          ("Outras Despesas", "despesa"),
        ],
      )


def seed_tenant_admin(slug: str, username: str, senha: str, nome: str):
  with get_tenant_db(slug) as conn:
    exists = conn.execute("SELECT id FROM usuarios WHERE username=?", (username,)).fetchone()
    if exists:
      conn.execute(
        "UPDATE usuarios SET senha=?, nome=?, role='admin', ativo=1 WHERE id=?",
        (pwd_ctx.hash(senha), nome, exists["id"]),
      )
    else:
      conn.execute(
        "INSERT INTO usuarios (username, senha, nome, role) VALUES (?, ?, ?, ?)",
        (username, pwd_ctx.hash(senha), nome, "admin"),
      )


def ensure_default_company():
  with get_master_db() as conn:
    exists = conn.execute(
      "SELECT 1 FROM empresas WHERE slug=?",
      (DEFAULT_COMPANY_SLUG,),
    ).fetchone()
    if exists:
      conn.execute(
        "UPDATE empresas SET nome=?, ativo=1 WHERE slug=?",
        (DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_SLUG),
      )
    else:
      conn.execute(
        "INSERT INTO empresas (nome, slug, ativo) VALUES (?, ?, 1)",
        (DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_SLUG),
      )

  init_tenant_db(DEFAULT_COMPANY_SLUG)
  seed_tenant_admin(
    DEFAULT_COMPANY_SLUG,
    DEFAULT_ADMIN_USER,
    DEFAULT_ADMIN_PASS,
    DEFAULT_ADMIN_NAME,
  )


def create_token(data: dict):
  exp = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
  return jwt.encode({**data, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def audit(conn, user, acao, tabela=None, detalhe=None):
  conn.execute(
    "INSERT INTO audit_log (usuario_id, username, acao, tabela, detalhe) VALUES (?, ?, ?, ?, ?)",
    (user["id"], user["username"], acao, tabela, detalhe),
  )


def get_master_setting(conn, chave: str):
  row = conn.execute("SELECT valor FROM sistema_controle WHERE chave=?", (chave,)).fetchone()
  return row["valor"] if row else None


def set_master_setting(conn, chave: str, valor: str):
  conn.execute(
    """
    INSERT INTO sistema_controle (chave, valor)
    VALUES (?, ?)
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor
    """,
    (chave, valor),
  )


def get_active_company_slugs():
  with get_master_db() as conn:
    return [row["slug"] for row in conn.execute("SELECT slug FROM empresas WHERE ativo=1").fetchall()]


def clear_company_sales_and_purchases(slug: str):
  if not os.path.exists(db_path_for(slug)):
    return

  with get_tenant_db(slug) as conn:
    conn.execute("DELETE FROM movimentos_estoque")
    conn.execute("DELETE FROM transacoes")
    conn.execute("DELETE FROM audit_log")


def run_year_end_cleanup_if_due():
  now = datetime.now()
  if now.month != 12 or now.day != 31:
    return

  cleanup_key = f"annual_cleanup_{now.year}"
  with get_master_db() as conn:
    if get_master_setting(conn, cleanup_key) == "done":
      return

  for slug in get_active_company_slugs():
    clear_company_sales_and_purchases(slug)

  with get_master_db() as conn:
    set_master_setting(conn, cleanup_key, "done")


async def annual_cleanup_scheduler():
  while True:
    run_year_end_cleanup_if_due()
    await asyncio.sleep(3600)


def append_table_to_sheet(conn, workbook, sheet_name: str, table_name: str):
  sheet = workbook.create_sheet(title=sheet_name)
  rows = conn.execute(f"SELECT * FROM {table_name}").fetchall()
  columns = [info["name"] for info in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]
  sheet.append(columns)
  for row in rows:
    sheet.append([row[column] for column in columns])


def build_company_backup_archive(slug: str):
  db_path = db_path_for(slug)
  if not os.path.exists(db_path):
    raise HTTPException(status_code=404, detail="Banco de dados da empresa não encontrado")

  workbook = Workbook()
  workbook.remove(workbook.active)

  with get_tenant_db(slug) as conn:
    conn.execute("PRAGMA wal_checkpoint(FULL)")
    for sheet_name, table_name in [
      ("Usuarios", "usuarios"),
      ("Categorias", "categorias_financeiro"),
      ("Clientes", "clientes"),
      ("Fornecedores", "fornecedores"),
      ("Transacoes", "transacoes"),
      ("Produtos", "produtos"),
      ("Movimentos", "movimentos_estoque"),
      ("Auditoria", "audit_log"),
    ]:
      append_table_to_sheet(conn, workbook, sheet_name, table_name)

  xlsx_buffer = io.BytesIO()
  workbook.save(xlsx_buffer)
  xlsx_buffer.seek(0)

  with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db_file:
    temp_db_path = temp_db_file.name

  try:
    source_conn = sqlite3.connect(db_path)
    backup_conn = sqlite3.connect(temp_db_path)
    try:
      source_conn.backup(backup_conn)
    finally:
      backup_conn.close()
      source_conn.close()

    zip_buffer = io.BytesIO()
    backup_date = datetime.now().strftime("%Y%m%d-%H%M%S")
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as backup_zip:
      backup_zip.write(temp_db_path, arcname=f"{slug}-backup-{backup_date}.db")
      backup_zip.writestr(f"{slug}-backup-{backup_date}.xlsx", xlsx_buffer.getvalue())
    zip_buffer.seek(0)
    return zip_buffer, backup_date
  finally:
    if os.path.exists(temp_db_path):
      os.remove(temp_db_path)


def get_default_despesa_categoria_id(conn):
  row = conn.execute(
    "SELECT id FROM categorias_financeiro WHERE tipo='despesa' ORDER BY id LIMIT 1"
  ).fetchone()
  return row["id"] if row else None


def register_stock_expense(conn, user, descricao: str, valor: float, observacao: Optional[str] = None):
  if valor <= 0:
    return

  categoria_id = get_default_despesa_categoria_id(conn)
  conn.execute(
    """
    INSERT INTO transacoes
    (tipo, descricao, valor, data, status, categoria_id, observacao, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """,
    (
      "despesa",
      descricao,
      valor,
      datetime.now().strftime("%Y-%m-%d"),
      "pago",
      categoria_id,
      observacao,
      user["id"],
    ),
  )
  audit(conn, user, "CRIAR_DESPESA_ESTOQUE", "transacoes", f"{descricao} R${valor:.2f}")


def verify_token(token: str = Depends(oauth2)):
  try:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    uid = payload.get("sub")
    slug = payload.get("slug")
    if uid is None:
      raise HTTPException(status_code=401, detail="Token inválido")
    return {"uid": int(uid), "slug": slug}
  except JWTError as exc:
    raise HTTPException(status_code=401, detail="Token inválido ou expirado") from exc


def get_current_user(tok: dict = Depends(verify_token)):
  slug = tok["slug"]
  if not slug:
    raise HTTPException(status_code=401, detail="Empresa não informada no token")

  with get_tenant_db(slug) as conn:
    user = conn.execute("SELECT * FROM usuarios WHERE id=? AND ativo=1", (tok["uid"],)).fetchone()
  if not user:
    raise HTTPException(status_code=401, detail="Usuário não encontrado")

  data = row_to_dict(user)
  data["slug"] = slug
  return data


def require_tenant_user(user=Depends(get_current_user)):
  return user


def scoped_actor_clause(user: dict, actor_alias: str, actor_id_field: str):
  if user["role"] == "admin":
    return "", []
  if user["role"] == "gerente":
    return f" AND {actor_alias}.role IN ('gerente', 'operador')", []
  return f" AND {actor_id_field}=?", [user["id"]]


def authenticate_tenant_user(slug: str, username: str, password: str):
  if not os.path.exists(db_path_for(slug)):
    return None
  with get_tenant_db(slug) as conn:
    user = conn.execute(
      "SELECT * FROM usuarios WHERE username=? AND ativo=1",
      (username,),
    ).fetchone()
    if user and pwd_ctx.verify(password, user["senha"]):
      user_dict = row_to_dict(user)
      audit(conn, user_dict, "LOGIN", "usuarios", "Login bem-sucedido")
      user_dict.pop("senha", None)
      user_dict["slug"] = slug
      return user_dict
  return None


def username_exists_globally(username: str) -> bool:
  normalized_username = username.strip()
  if not normalized_username:
    return False

  with get_master_db() as conn:
    empresas = rows_to_list(conn.execute("SELECT slug FROM empresas").fetchall())

  for empresa in empresas:
    db_path = db_path_for(empresa["slug"])
    if not os.path.exists(db_path):
      continue
    with get_tenant_db(empresa["slug"]) as conn:
      user_exists = conn.execute(
        "SELECT 1 FROM usuarios WHERE username=?",
        (normalized_username,),
      ).fetchone()
      if user_exists:
        return True

  return False


class TenantUserIn(BaseModel):
  username: str
  senha: str
  nome: str
  role: str


class TenantUserStatusIn(BaseModel):
  ativo: bool


class TenantUserPasswordIn(BaseModel):
  senha: str


class AdminOwnPasswordIn(BaseModel):
  senha_atual: str
  nova_senha: str
  confirmar_senha: str


class ProdutoIn(BaseModel):
  codigo: str
  nome: str
  descricao: Optional[str] = ""
  estoque_atual: float = 0
  estoque_minimo: float = 0
  custo: float = 0
  preco_venda: float = 0
  unidade: str = "un"


class MovimentoIn(BaseModel):
  produto_id: int
  tipo: str
  quantidade: float
  custo_unitario: float = 0
  observacao: Optional[str] = None


class TransacaoIn(BaseModel):
  tipo: str
  descricao: str
  valor: float
  data: str
  status: str = "pago"
  categoria_id: Optional[int] = None
  cliente_id: Optional[int] = None
  fornecedor_id: Optional[int] = None
  observacao: Optional[str] = None


class TransacaoStatusIn(BaseModel):
  status: str


@asynccontextmanager
async def lifespan(_: FastAPI):
  init_master_db()
  ensure_default_company()
  run_year_end_cleanup_if_due()
  cleanup_task = asyncio.create_task(annual_cleanup_scheduler())
  try:
    yield
  finally:
    cleanup_task.cancel()
    try:
      await cleanup_task
    except asyncio.CancelledError:
      pass


app = FastAPI(title="FinControl Pro API", lifespan=lifespan)

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.post("/auth/login")
async def login(
  username: str = Form(...),
  password: str = Form(...),
  x_empresa_slug: Optional[str] = Header(None),
):
  if x_empresa_slug:
    user = authenticate_tenant_user(x_empresa_slug.strip().lower(), username, password)
    if not user:
      raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
    token = create_token({"sub": str(user["id"]), "slug": user["slug"]})
    return {"access_token": token, "token_type": "bearer", "usuario": user}

  with get_master_db() as conn:
    empresas = rows_to_list(conn.execute("SELECT slug FROM empresas WHERE ativo=1 ORDER BY nome").fetchall())

  for empresa in empresas:
    user = authenticate_tenant_user(empresa["slug"], username, password)
    if user:
      token = create_token({"sub": str(user["id"]), "slug": user["slug"]})
      return {"access_token": token, "token_type": "bearer", "usuario": user}

  raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")


@app.get("/empresa/usuarios")
async def list_empresa_users(user=Depends(require_tenant_user)):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode gerenciar usuarios")
  with get_tenant_db(user["slug"]) as conn:
    rows = conn.execute(
      "SELECT id, username, nome, role, ativo, criado_em FROM usuarios ORDER BY criado_em DESC, id DESC"
    ).fetchall()
  return rows_to_list(rows)


@app.get("/empresa/backup")
async def download_empresa_backup(user=Depends(require_tenant_user)):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode gerar backup")

  zip_buffer, backup_date = build_company_backup_archive(user["slug"])
  return StreamingResponse(
    zip_buffer,
    media_type="application/zip",
    headers={
      "Content-Disposition": f'attachment; filename="{user["slug"]}-backup-{backup_date}.zip"'
    },
  )


@app.post("/empresa/restore")
async def restore_empresa_backup(
  file: UploadFile = File(...),
  user=Depends(require_tenant_user)
):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode restaurar backup")

  if not file.filename.endswith('.db'):
    raise HTTPException(status_code=400, detail="O arquivo deve ter extensão .db")

  slug = user["slug"]
  current_db_path = db_path_for(slug)

  # Cria backup de segurança do banco atual
  backup_safety_path = f"{current_db_path}.backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
  try:
    if os.path.exists(current_db_path):
      import shutil
      shutil.copy2(current_db_path, backup_safety_path)
  except Exception as e:
    raise HTTPException(
      status_code=500,
      detail=f"Erro ao criar backup de segurança: {str(e)}"
    )

  # Salva o arquivo enviado temporariamente
  with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_file:
    temp_db_path = temp_file.name
    content = await file.read()
    temp_file.write(content)

  try:
    # Valida se é um banco SQLite válido
    test_conn = sqlite3.connect(temp_db_path)
    try:
      test_conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").fetchone()
      test_conn.close()
    except sqlite3.DatabaseError:
      os.remove(temp_db_path)
      raise HTTPException(status_code=400, detail="Arquivo .db inválido ou corrompido")

    # Remove arquivos WAL e SHM do banco atual se existirem
    for ext in ["-wal", "-shm"]:
      wal_file = f"{current_db_path}{ext}"
      if os.path.exists(wal_file):
        try:
          os.remove(wal_file)
        except:
          pass

    # Substitui o banco atual pelo banco do backup
    import shutil
    shutil.move(temp_db_path, current_db_path)

    # Registra a restauração no log de auditoria
    with get_tenant_db(slug) as conn:
      audit(conn, user, "RESTAURAR_BACKUP", "sistema", f"Backup restaurado do arquivo {file.filename}")

    return {
      "ok": True,
      "message": "Backup restaurado com sucesso",
      "backup_safety": backup_safety_path
    }

  except HTTPException:
    raise
  except Exception as e:
    # Em caso de erro, restaura o backup de segurança
    if os.path.exists(backup_safety_path):
      import shutil
      shutil.copy2(backup_safety_path, current_db_path)
    
    if os.path.exists(temp_db_path):
      os.remove(temp_db_path)
    
    raise HTTPException(
      status_code=500,
      detail=f"Erro ao restaurar backup: {str(e)}"
    )


@app.post("/empresa/usuarios", status_code=201)
async def create_empresa_user(payload: TenantUserIn, user=Depends(require_tenant_user)):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode criar usuarios")
  if payload.role not in {"gerente", "operador"}:
    raise HTTPException(status_code=400, detail="O admin pode criar apenas gerente ou operador")
  if len(payload.senha) < 4:
    raise HTTPException(status_code=400, detail="A senha deve ter pelo menos 4 caracteres")
  if username_exists_globally(payload.username):
    raise HTTPException(status_code=400, detail="Esse Nome de Login Não é Aceito")

  with get_tenant_db(user["slug"]) as conn:
    cur = conn.execute(
      "INSERT INTO usuarios (username, senha, nome, role) VALUES (?, ?, ?, ?)",
      (payload.username, pwd_ctx.hash(payload.senha), payload.nome, payload.role),
    )
    audit(conn, user, "CRIAR_USUARIO_EMPRESA", "usuarios", f"{payload.username} ({payload.role})")
  return {"id": cur.lastrowid, "ok": True}


@app.put("/empresa/usuarios/{uid}/status")
async def update_empresa_user_status(uid: int, payload: TenantUserStatusIn, user=Depends(require_tenant_user)):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode alterar usuarios")
  with get_tenant_db(user["slug"]) as conn:
    row = conn.execute("SELECT id, username, role FROM usuarios WHERE id=?", (uid,)).fetchone()
    if not row:
      raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if row["role"] == "admin":
      raise HTTPException(status_code=400, detail="Não é permitido desativar o admin principal da empresa")
    conn.execute("UPDATE usuarios SET ativo=? WHERE id=?", (1 if payload.ativo else 0, uid))
    audit(conn, user, "ALTERAR_STATUS_USUARIO_EMPRESA", "usuarios", f"{row['username']} -> {payload.ativo}")
  return {"ok": True}


@app.put("/empresa/usuarios/{uid}/senha")
async def update_empresa_user_password(uid: int, payload: TenantUserPasswordIn, user=Depends(require_tenant_user)):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode redefinir senhas")
  if len(payload.senha) < 4:
    raise HTTPException(status_code=400, detail="A senha deve ter pelo menos 4 caracteres")
  with get_tenant_db(user["slug"]) as conn:
    row = conn.execute("SELECT id, username FROM usuarios WHERE id=?", (uid,)).fetchone()
    if not row:
      raise HTTPException(status_code=404, detail="Usuário não encontrado")
    conn.execute("UPDATE usuarios SET senha=? WHERE id=?", (pwd_ctx.hash(payload.senha), uid))
    audit(conn, user, "REDEFINIR_SENHA_USUARIO_EMPRESA", "usuarios", row["username"])
  return {"ok": True}


@app.put("/empresa/admin/minha-senha")
async def update_admin_own_password(payload: AdminOwnPasswordIn, user=Depends(require_tenant_user)):
  if user["role"] != "admin":
    raise HTTPException(status_code=403, detail="Somente o admin da empresa pode alterar a própria senha")
  if len(payload.nova_senha) < 4:
    raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 4 caracteres")
  if payload.nova_senha != payload.confirmar_senha:
    raise HTTPException(status_code=400, detail="A confirmação da nova senha não confere")

  with get_tenant_db(user["slug"]) as conn:
    row = conn.execute("SELECT id, username, senha FROM usuarios WHERE id=? AND role='admin'", (user["id"],)).fetchone()
    if not row:
      raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if not pwd_ctx.verify(payload.senha_atual, row["senha"]):
      raise HTTPException(status_code=400, detail="Senha atual incorreta")

    conn.execute("UPDATE usuarios SET senha=? WHERE id=?", (pwd_ctx.hash(payload.nova_senha), user["id"]))
    audit(conn, user, "ALTERAR_SENHA_PROPRIA_ADMIN", "usuarios", row["username"])
  return {"ok": True}


@app.get("/dashboard/resumo")
async def dashboard_resumo(user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    clause, params = scoped_actor_clause(user, "u", "t.usuario_id")
    total_receitas = conn.execute(
      f"""
      SELECT COALESCE(SUM(t.valor), 0)
      FROM transacoes t
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.tipo='receita' AND t.status='pago'{clause}
      """,
      params,
    ).fetchone()[0]
    total_despesas = conn.execute(
      f"""
      SELECT COALESCE(SUM(t.valor), 0)
      FROM transacoes t
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.tipo='despesa' AND t.status='pago'{clause}
      """,
      params,
    ).fetchone()[0]
    total_produtos = conn.execute("SELECT COUNT(*) FROM produtos WHERE ativo=1").fetchone()[0]
    estoque_baixo = conn.execute(
      "SELECT COUNT(*) FROM produtos WHERE ativo=1 AND estoque_atual <= estoque_minimo"
    ).fetchone()[0]

  return {
    "saldo_atual": total_receitas - total_despesas,
    "total_receitas": total_receitas,
    "total_despesas": total_despesas,
    "total_produtos": total_produtos,
    "estoque_baixo": estoque_baixo,
  }


@app.get("/transacoes")
async def get_transacoes(
  tipo: Optional[str] = Query(None),
  q: Optional[str] = Query(None),
  status: Optional[str] = Query(None),
  user=Depends(require_tenant_user),
):
  sql = """
    SELECT
      t.*,
      c.nome AS categoria_nome,
      cl.nome AS cliente_nome,
      f.razao_social AS fornecedor_nome,
      u.nome AS usuario_nome,
      u.username AS usuario_username,
      u.role AS usuario_role
    FROM transacoes t
    LEFT JOIN categorias_financeiro c ON c.id = t.categoria_id
    LEFT JOIN clientes cl ON cl.id = t.cliente_id
    LEFT JOIN fornecedores f ON f.id = t.fornecedor_id
    LEFT JOIN usuarios u ON u.id = t.usuario_id
    WHERE 1=1
  """
  params = []
  clause, clause_params = scoped_actor_clause(user, "u", "t.usuario_id")
  sql += clause
  params.extend(clause_params)
  if tipo:
    sql += " AND t.tipo=?"
    params.append(tipo)
  if status:
    sql += " AND t.status=?"
    params.append(status)
  if q:
    sql += " AND t.descricao LIKE ?"
    params.append(f"%{q}%")
  sql += " ORDER BY t.data DESC, t.id DESC"

  with get_tenant_db(user["slug"]) as conn:
    return rows_to_list(conn.execute(sql, params).fetchall())


@app.post("/transacoes", status_code=201)
async def create_transacao(payload: TransacaoIn, user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    cur = conn.execute(
      """
      INSERT INTO transacoes
      (tipo, descricao, valor, data, status, categoria_id, cliente_id, fornecedor_id, observacao, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
      (
        payload.tipo,
        payload.descricao,
        payload.valor,
        payload.data,
        payload.status,
        payload.categoria_id,
        payload.cliente_id,
        payload.fornecedor_id,
        payload.observacao,
        user["id"],
      ),
    )
    audit(conn, user, f"CRIAR_{payload.tipo.upper()}", "transacoes", payload.descricao)
  return {"id": cur.lastrowid, "ok": True}


@app.put("/transacoes/{tid}/status")
async def update_transacao_status(tid: int, payload: TransacaoStatusIn, user=Depends(require_tenant_user)):
  if payload.status not in {"pago", "pendente", "cancelado"}:
    raise HTTPException(status_code=400, detail="Status inválido")
  with get_tenant_db(user["slug"]) as conn:
    found = conn.execute("SELECT * FROM transacoes WHERE id=?", (tid,)).fetchone()
    if not found:
      raise HTTPException(status_code=404, detail="Transação não encontrada")
    conn.execute("UPDATE transacoes SET status=? WHERE id=?", (payload.status, tid))
    audit(conn, user, "ALTERAR_STATUS_TRANSACAO", "transacoes", f"ID {tid} -> {payload.status}")
  return {"ok": True}


@app.delete("/transacoes/{tid}", status_code=204)
async def delete_transacao(tid: int, user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    found = conn.execute("SELECT descricao FROM transacoes WHERE id=?", (tid,)).fetchone()
    if not found:
      raise HTTPException(status_code=404, detail="Transação não encontrada")
    conn.execute("DELETE FROM transacoes WHERE id=?", (tid,))
    audit(conn, user, "EXCLUIR_TRANSACAO", "transacoes", found["descricao"])


@app.get("/produtos")
async def get_produtos(q: Optional[str] = Query(None), user=Depends(require_tenant_user)):
  sql = "SELECT * FROM produtos WHERE ativo=1"
  params = []
  if q:
    sql += " AND (codigo LIKE ? OR nome LIKE ? OR descricao LIKE ?)"
    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
  sql += " ORDER BY nome"
  with get_tenant_db(user["slug"]) as conn:
    return rows_to_list(conn.execute(sql, params).fetchall())


@app.post("/produtos", status_code=201)
async def create_produto(payload: ProdutoIn, user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    try:
      cur = conn.execute(
        """
        INSERT INTO produtos
        (codigo, nome, descricao, estoque_atual, estoque_minimo, custo, preco_venda, unidade)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
          payload.codigo,
          payload.nome,
          payload.descricao,
          payload.estoque_atual,
          payload.estoque_minimo,
          payload.custo,
          payload.preco_venda,
          payload.unidade,
        ),
      )
    except sqlite3.IntegrityError as exc:
      raise HTTPException(status_code=400, detail="Código já cadastrado") from exc

    if payload.estoque_atual > 0:
      conn.execute(
        """
        INSERT INTO movimentos_estoque
        (produto_id, tipo, quantidade, custo_unitario, observacao, usuario_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (cur.lastrowid, "entrada", payload.estoque_atual, payload.custo, "Estoque inicial", user["id"]),
      )
      register_stock_expense(
        conn,
        user,
        f"Entrada de estoque inicial - {payload.nome}",
        payload.estoque_atual * payload.custo,
        "Despesa gerada automaticamente pela entrada inicial em estoque",
      )
    audit(conn, user, "CRIAR_PRODUTO", "produtos", payload.nome)
  return {"id": cur.lastrowid, "ok": True}


@app.put("/produtos/{pid}")
async def update_produto(pid: int, payload: ProdutoIn, user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    produto = conn.execute("SELECT * FROM produtos WHERE id=? AND ativo=1", (pid,)).fetchone()
    if not produto:
      raise HTTPException(status_code=404, detail="Produto não encontrado")

    estoque_anterior = float(produto["estoque_atual"] or 0)
    estoque_novo = float(payload.estoque_atual or 0)
    delta = estoque_novo - estoque_anterior

    try:
      conn.execute(
        """
        UPDATE produtos
        SET codigo=?, nome=?, descricao=?, estoque_atual=?, estoque_minimo=?, custo=?, preco_venda=?, unidade=?
        WHERE id=?
        """,
        (
          payload.codigo,
          payload.nome,
          payload.descricao,
          estoque_novo,
          payload.estoque_minimo,
          payload.custo,
          payload.preco_venda,
          payload.unidade,
          pid,
        ),
      )
    except sqlite3.IntegrityError as exc:
      raise HTTPException(status_code=400, detail="Código já cadastrado") from exc

    if delta != 0:
      conn.execute(
        """
        INSERT INTO movimentos_estoque
        (produto_id, tipo, quantidade, custo_unitario, observacao, usuario_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
          pid,
          "entrada" if delta > 0 else "saida",
          abs(delta),
          payload.custo,
          "Ajuste manual via edição do produto",
          user["id"],
        ),
      )
      if delta > 0:
        register_stock_expense(
          conn,
          user,
          f"Reposição de estoque - {payload.nome}",
          abs(delta) * payload.custo,
          "Despesa gerada automaticamente por aumento de estoque via edição do produto",
        )

    audit(conn, user, "EDITAR_PRODUTO", "produtos", payload.nome)
  return {"ok": True}


@app.delete("/produtos/{pid}", status_code=204)
async def delete_produto(pid: int, user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    produto = conn.execute("SELECT nome FROM produtos WHERE id=? AND ativo=1", (pid,)).fetchone()
    if not produto:
      raise HTTPException(status_code=404, detail="Produto não encontrado")
    conn.execute("UPDATE produtos SET ativo=0 WHERE id=?", (pid,))
    audit(conn, user, "EXCLUIR_PRODUTO", "produtos", produto["nome"])


@app.get("/movimentos")
async def get_movimentos(tipo: Optional[str] = Query(None), user=Depends(require_tenant_user)):
  sql = """
    SELECT
      m.*,
      p.nome AS produto_nome,
      p.codigo AS produto_codigo,
      u.nome AS usuario_nome,
      u.username AS usuario_username,
      u.role AS usuario_role
    FROM movimentos_estoque m
    LEFT JOIN produtos p ON p.id = m.produto_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE 1=1
  """
  params = []
  clause, clause_params = scoped_actor_clause(user, "u", "m.usuario_id")
  sql += clause
  params.extend(clause_params)
  if tipo:
    sql += " AND m.tipo=?"
    params.append(tipo)
  sql += " ORDER BY m.data_hora DESC LIMIT 200"
  with get_tenant_db(user["slug"]) as conn:
    return rows_to_list(conn.execute(sql, params).fetchall())


@app.post("/movimentos", status_code=201)
async def create_movimento(payload: MovimentoIn, user=Depends(require_tenant_user)):
  if payload.tipo not in {"entrada", "saida", "ajuste"}:
    raise HTTPException(status_code=400, detail="Tipo de movimento inválido")

  with get_tenant_db(user["slug"]) as conn:
    produto = conn.execute(
      "SELECT * FROM produtos WHERE id=? AND ativo=1",
      (payload.produto_id,),
    ).fetchone()
    if not produto:
      raise HTTPException(status_code=404, detail="Produto não encontrado")

    if payload.tipo == "saida" and float(produto["estoque_atual"]) < payload.quantidade:
      raise HTTPException(
        status_code=400,
        detail=f"Estoque insuficiente. Disponível: {produto['estoque_atual']}",
      )

    if payload.tipo == "entrada":
      delta = payload.quantidade
    elif payload.tipo == "saida":
      delta = -payload.quantidade
    else:
      delta = payload.quantidade

    conn.execute(
      "UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id=?",
      (delta, payload.produto_id),
    )
    cur = conn.execute(
      """
      INSERT INTO movimentos_estoque
      (produto_id, tipo, quantidade, custo_unitario, observacao, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?)
      """,
      (
        payload.produto_id,
        payload.tipo,
        payload.quantidade,
        payload.custo_unitario,
        payload.observacao,
        user["id"],
      ),
    )
    if payload.tipo == "entrada":
      register_stock_expense(
        conn,
        user,
        f"Entrada de estoque - {produto['nome']}",
        payload.quantidade * payload.custo_unitario,
        payload.observacao or "Despesa gerada automaticamente por entrada manual em estoque",
      )
    audit(conn, user, f"MOVIMENTO_{payload.tipo.upper()}", "movimentos_estoque", produto["nome"])
  return {"id": cur.lastrowid, "ok": True}


@app.get("/relatorios/dre")
async def relatorio_dre(user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    clause, params = scoped_actor_clause(user, "u", "t.usuario_id")
    receita = conn.execute(
      f"""
      SELECT COALESCE(SUM(t.valor), 0)
      FROM transacoes t
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.tipo='receita' AND t.status='pago'{clause}
      """,
      params,
    ).fetchone()[0]
    despesa = conn.execute(
      f"""
      SELECT COALESCE(SUM(t.valor), 0)
      FROM transacoes t
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.tipo='despesa' AND t.status='pago'{clause}
      """,
      params,
    ).fetchone()[0]
  resultado = receita - despesa
  margem = round((resultado / receita) * 100, 1) if receita else 0
  return {
    "receita_bruta": receita,
    "despesas_totais": despesa,
    "resultado": resultado,
    "margem": margem,
  }


@app.get("/relatorios/top-produtos")
async def relatorio_top_produtos(user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    clause, params = scoped_actor_clause(user, "u", "m.usuario_id")
    rows = conn.execute(
      f"""
      SELECT p.nome,
             SUM(CASE WHEN m.tipo='entrada' THEN m.quantidade ELSE 0 END) AS entradas,
             SUM(CASE WHEN m.tipo='saida' THEN m.quantidade ELSE 0 END) AS saidas
      FROM movimentos_estoque m
      JOIN produtos p ON p.id = m.produto_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE 1=1{clause}
      GROUP BY p.id
      ORDER BY saidas DESC, entradas DESC
      LIMIT 5
      """,
      params,
    ).fetchall()
  return rows_to_list(rows)


@app.get("/relatorios/audit-log")
async def relatorio_audit_log(user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    clause, params = scoped_actor_clause(user, "u", "a.usuario_id")
    rows = conn.execute(
      f"""
      SELECT
        a.*,
        COALESCE(u.nome, a.username) AS usuario_nome,
        u.username AS usuario_username,
        u.role AS usuario_role
      FROM audit_log a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE 1=1{clause}
      ORDER BY a.data_hora DESC
      LIMIT 100
      """,
      params,
    ).fetchall()
  return rows_to_list(rows)


@app.get("/categorias-financeiro")
async def get_categorias_financeiro(user=Depends(require_tenant_user)):
  with get_tenant_db(user["slug"]) as conn:
    return rows_to_list(conn.execute("SELECT * FROM categorias_financeiro ORDER BY nome").fetchall())


@app.get("/clientes")
async def get_clientes(q: Optional[str] = Query(None), user=Depends(require_tenant_user)):
  sql = "SELECT * FROM clientes WHERE 1=1"
  params = []
  if q:
    sql += " AND (nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ? OR email LIKE ?)"
    params.extend([f"%{q}%"] * 4)
  sql += " ORDER BY nome"
  with get_tenant_db(user["slug"]) as conn:
    return rows_to_list(conn.execute(sql, params).fetchall())


@app.get("/fornecedores")
async def get_fornecedores(q: Optional[str] = Query(None), user=Depends(require_tenant_user)):
  sql = "SELECT * FROM fornecedores WHERE 1=1"
  params = []
  if q:
    sql += " AND (razao_social LIKE ? OR cnpj LIKE ? OR contato LIKE ?)"
    params.extend([f"%{q}%"] * 3)
  sql += " ORDER BY razao_social"
  with get_tenant_db(user["slug"]) as conn:
    return rows_to_list(conn.execute(sql, params).fetchall())


BASE_DIR = os.path.dirname(os.path.abspath(__file__))


@app.get("/", include_in_schema=False)
async def serve_index():
  return FileResponse(os.path.join(BASE_DIR, "index.html"))


app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")


if __name__ == "__main__":
  import uvicorn

  port = int(os.environ.get("PORT", 8080))
  uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
