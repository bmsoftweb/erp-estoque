import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { masterPool, getDb } from './db.js';
import bcrypt from 'bcryptjs';

export function createUsuariosRouter() {
  const router = Router();

  router.get('/users', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      
      if (!session.isLoggedIn) {
        return res.status(401).json({ error: 'Não autorizado' });
      }
  
      // Fetch all users from the 'usuarios' table in MANAGEMENT base
      const [users]: any = await masterPool.execute(
        'SELECT id, nome, email, senha, role, perfil_id FROM usuarios ORDER BY id DESC'
      );
  
      return res.json(users);
    } catch (error: any) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Erro ao buscar usuários: ' + error.message });
    }
  });

  router.post('/users', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      
      if (!session.isLoggedIn) {
        return res.status(401).json({ error: 'Não autorizado' });
      }
  
      const { nome, email, senha, role } = req.body;
  
      if (!nome || !email || !senha) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
      }
  
      const hashedPassword = await bcrypt.hash(senha, 10);
  
      const [result]: any = await masterPool.execute(
        'INSERT INTO usuarios (nome, email, senha, role) VALUES (?, ?, ?, ?)',
        [nome, email, hashedPassword, role || 'user']
      );
  
      return res.json({ id: result.insertId, nome, email, role: role || 'user' });
    } catch (error: any) {
      console.error('Error creating user:', error);
      return res.status(500).json({ error: 'Erro ao criar usuário: ' + error.message });
    }
  });

  router.patch('/users/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      
      if (!session.isLoggedIn) {
        return res.status(401).json({ error: 'Não autorizado' });
      }
  
      const { nome, email, senha, role } = req.body;
  
      if (!nome || !email || !senha) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
      }
  
      await masterPool.execute(
        'UPDATE usuarios SET nome = ?, email = ?, senha = ?, role = ? WHERE id = ?',
        [nome, email, senha, role || 'user', id]
      );
  
      return res.json({ id, nome, email, senha, role: role || 'user' });
    } catch (error: any) {
      console.error('Error updating user:', error);
      return res.status(500).json({ error: 'Erro ao atualizar usuário: ' + error.message });
    }
  });

  router.delete('/users/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      
      if (!session.isLoggedIn) {
        return res.status(401).json({ error: 'Não autorizado' });
      }
  
      await masterPool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
  
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      return res.status(500).json({ error: 'Erro ao excluir usuário: ' + error.message });
    }
  });

  return router;
}
