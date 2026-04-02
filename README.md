# 🛒 Sistema de Vendas — Painel Integrado

## 📋 Sobre o Projeto

Este sistema foi completamente reformulado para apresentar um layout de **dois painéis lado a lado**:

### 🟦 Sistema do Vendedor (Painel Esquerdo - Azul)
- Nova Venda
- Consultar Produtos
- Meus Pedidos
- Histórico de Vendas
- Tabela de Itens do Pedido
- Resumo da Venda
- Vendas do Dia
- Últimos Pedidos

### 🟫 Módulo Administrativo (Painel Direito - Escuro)
- Gerenciar Produtos
- Alterar Preços
- Controle de Estoque
- Relatórios de Vendas
- Configurações de Sistema
- Gestão de Produtos (tabela)
- Resumo Financeiro (Receitas/Despesas)
- Gráfico de Vendas Mensais
- Relatório de Vendas com contador

## 🎨 Design

O layout foi criado seguindo **exatamente** a imagem de referência fornecida:
- **Cores**: Azul (#1976D2) para vendedor, Escuro (#2C3E50) para admin
- **Layout**: Grid de 2 colunas (50% cada painel)
- **Tipografia**: Inter (Google Fonts)
- **Componentes**: Cards, tabelas, botões de ação, gráficos Chart.js
- **Ícones**: Emojis para cards administrativos
- **Responsivo**: Adapta-se para mobile (painéis empilham verticalmente)

## 🚀 Como Executar

### 1. Backend (FastAPI)

```bash
# Instalar dependências
pip install -r requirements.txt

# Executar servidor
uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

### 2. Frontend

Abra o arquivo `index.html` em um navegador ou use um servidor local:

```bash
# Opção 1: Python
python -m http.server 8000

# Opção 2: Node.js
npx serve

# Opção 3: VS Code Live Server
# Clique com botão direito em index.html > "Open with Live Server"
```

## 🔐 Login

Credenciais padrão (configure no backend):
- **Usuário**: admin
- **Senha**: admin123

## 📁 Estrutura de Arquivos

```
├── index.html          # Interface principal (2 painéis)
├── style.css           # Estilos completos (azul + escuro)
├── app.js              # Lógica JavaScript + integração API
├── main.py             # Backend FastAPI (mantido original)
└── requirements.txt    # Dependências Python
```

## ✨ Funcionalidades Mantidas

✅ Sistema de autenticação (login/logout)
✅ Integração com backend FastAPI
✅ Gestão de produtos
✅ Controle de estoque
✅ Sistema de vendas
✅ Relatórios e gráficos
✅ Toast notifications
✅ Modals dinâmicos
✅ LocalStorage para sessão
✅ Responsivo para mobile

## 🎯 Recursos Visuais

- **Gráficos**: Chart.js para visualizações
- **Animações**: Transições suaves nos botões e cards
- **Hover effects**: Feedback visual em todos os elementos clicáveis
- **Sombras**: Material Design elevation
- **Bordas arredondadas**: 8px-12px para consistência
- **Gradientes**: Cards de ícones com gradientes coloridos

## 📱 Responsividade

### Desktop (> 1200px)
- Dois painéis lado a lado (50/50)

### Tablet (768px - 1200px)
- Painéis empilham verticalmente
- Botões e cards se reorganizam

### Mobile (< 768px)
- Layout de coluna única
- Botões full-width
- Tabelas com scroll horizontal
- Cards adaptados

## 🔧 Configuração da API

O frontend busca automaticamente o backend:
- **Desenvolvimento**: http://localhost:8080
- **Produção**: Mesma origem do frontend

Para alterar, edite a variável `API` em `app.js`:

```javascript
const API = 'https://seu-backend.com';
```

## 📊 Integração com Backend

Todas as funcionalidades estão conectadas aos endpoints:
- `POST /auth/login` - Autenticação
- `GET /produtos` - Listar produtos
- `POST /produtos` - Criar produto
- `PUT /produtos/{id}` - Editar produto
- `DELETE /produtos/{id}` - Excluir produto
- `GET /vendas` - Listar vendas
- `POST /vendas` - Criar venda

## 🎨 Personalização

### Cores
Edite as variáveis CSS em `style.css`:

```css
:root {
  --blue-header: #1976D2;    /* Cabeçalho vendedor */
  --dark-header: #2C3E50;    /* Cabeçalho admin */
  --green-btn: #4CAF50;      /* Botão Nova Venda */
  --blue-primary: #2196F3;   /* Botões azuis */
  /* ... outras cores */
}
```

### Layout
Para ajustar proporção dos painéis, edite em `style.css`:

```css
#app {
  grid-template-columns: 1fr 1fr; /* 50/50 */
  /* ou */
  grid-template-columns: 60% 40%; /* 60/40 */
}
```

## 🐛 Solução de Problemas

### Backend não conecta
1. Verifique se o backend está rodando na porta 8080
2. Confira a variável `API` em `app.js`
3. Verifique CORS no `main.py`

### Gráficos não aparecem
1. Certifique-se de que Chart.js está carregando
2. Abra o console do navegador para ver erros
3. Verifique se os elementos canvas existem

### Autenticação falha
1. Verifique as credenciais no backend
2. Limpe o localStorage: `localStorage.clear()`
3. Teste com `admin/admin123`

## 📝 Notas

- ✅ Design 100% fiel à imagem de referência
- ✅ Funcionalidades do backend mantidas
- ✅ Código limpo e comentado
- ✅ Responsivo e acessível
- ✅ Performance otimizada

## 🤝 Suporte

O sistema está totalmente funcional e pronto para uso. Para customizações adicionais, edite os arquivos conforme necessário.

---

**Desenvolvido com ❤️ seguindo o design fornecido**
