const API = window.location.origin.includes('localhost') ? 'http://localhost:8080' : '';

let currentUser = null;
let authToken = null;
let chartVendasMensais = null;
let chartRelatorioVendas = null;
let defaultAdminPanelMarkup = '';
const COMPANY_NAME = 'JM MULT CELL';

const state = {
  produtos: [],
  receitas: [],
  despesas: [],
  movimentos: [],
  resumo: null,
  dre: null,
  topProdutos: [],
  auditLog: [],
  tenantUsers: [],
  currentSale: {
    items: [],
    paymentMethod: 'Cartão',
  },
  lastReceipt: null,
};

function hasAdminDashboard() {
  return currentUser?.role === 'admin';
}

function hasSalesDashboard() {
  return currentUser?.role === 'gerente' || currentUser?.role === 'operador';
}

function shouldShowSellerInfo() {
  return currentUser?.role === 'gerente' || currentUser?.role === 'admin';
}

function sellerDisplayName(item) {
  return item?.usuario_nome || item?.usuario_username || 'Não identificado';
}

function actorDisplayName(item) {
  return item?.usuario_nome || item?.usuario_username || item?.username || 'Não identificado';
}

async function api(method, path, body = null, extraHeaders = {}) {
  const headers = { ...extraHeaders };

  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    doLogout();
    return null;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
    throw new Error(err.detail || 'Erro na requisição');
  }

  return res.status === 204 ? null : res.json();
}

async function apiForm(path, formData, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const res = await fetch(API + path, {
    method: 'POST',
    body: formData,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
    throw new Error(err.detail || 'Erro na autenticação');
  }

  return res.json();
}

async function apiDownload(path, filename) {
  const headers = {};

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(API + path, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
    throw new Error(err.detail || 'Erro ao baixar arquivo');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getSaleTotal() {
  return state.currentSale.items.reduce((total, item) => total + item.total, 0);
}

function getTodayRevenueTotal() {
  const today = todayIsoDate();
  return state.receitas
    .filter((item) => String(item.data || '').slice(0, 10) === today && item.status === 'pago')
    .reduce((total, item) => total + safeNumber(item.valor), 0);
}

function getMonthSalesCount() {
  const now = new Date();
  return state.receitas.filter((item) => {
    if (!item.data) return false;
    const date = new Date(item.data);
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      item.status !== 'cancelado'
    );
  }).length;
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(safeNumber(value));
}

function formatDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pt-BR');
}

function formatDateTime(date) {
  if (!date) return '-';
  return new Date(date).toLocaleString('pt-BR');
}

function getCurrentMonthExpenses() {
  const now = new Date();
  return state.despesas.filter((item) => {
    if (!item.data || item.status === 'cancelado') return false;
    const date = new Date(item.data);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
}

function openPrintWindow(title, content) {
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    showToast('Não foi possível abrir a impressão.', 'error');
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; padding: 24px; }
          h1, h2, h3 { margin: 0 0 12px; }
          p { margin: 0 0 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
          th { background: #f3f4f6; }
          .print-header { margin-bottom: 20px; }
          .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
          .print-card { border: 1px solid #d1d5db; padding: 14px; border-radius: 8px; }
          .print-total { margin-top: 18px; font-size: 18px; font-weight: bold; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>${content}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function buildExpensePrintMarkup() {
  const expenses = getCurrentMonthExpenses();
  const total = expenses.reduce((sum, item) => sum + safeNumber(item.valor), 0);
  const monthLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return `
    <div class="print-header">
      <h1>${COMPANY_NAME}</h1>
      <h2>Relatório de Despesas</h2>
      <p>Período: ${escapeHtml(monthLabel)}</p>
      <p>Impresso em: ${formatDateTime(new Date().toISOString())}</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Descrição</th>
          <th>Responsável</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        ${expenses.length === 0
          ? '<tr><td colspan="4">Nenhuma despesa registrada no mês atual.</td></tr>'
          : expenses.map((item) => `
              <tr>
                <td>${formatDate(item.data)}</td>
                <td>${escapeHtml(item.descricao || '-')}</td>
                <td>${escapeHtml(actorDisplayName(item))}</td>
                <td>${formatMoney(item.valor)}</td>
              </tr>
            `).join('')}
      </tbody>
    </table>
    <div class="print-total">Total do mês: ${formatMoney(total)}</div>
  `;
}

function buildServiceOrderPrintMarkup(data) {
  return `
    <div class="print-header">
      <h1>${COMPANY_NAME}</h1>
      <h2>Ordem de Serviço</h2>
      <p>Ramo: manutenção de celulares e acessórios em geral</p>
      <p>Data de emissão: ${formatDateTime(new Date().toISOString())}</p>
    </div>
    <div class="print-grid">
      <div class="print-card">
        <h3>Cliente</h3>
        <p><strong>Nome:</strong> ${escapeHtml(data.clienteNome)}</p>
        <p><strong>Telefone:</strong> ${escapeHtml(data.clienteTelefone)}</p>
      </div>
      <div class="print-card">
        <h3>Aparelho</h3>
        <p><strong>Tipo:</strong> ${escapeHtml(data.aparelhoTipo)}</p>
        <p><strong>Marca/Modelo:</strong> ${escapeHtml(data.aparelhoModelo)}</p>
        <p><strong>IMEI/Serial:</strong> ${escapeHtml(data.aparelhoSerial)}</p>
      </div>
    </div>
    <div class="print-card" style="margin-top: 16px;">
      <h3>Atendimento</h3>
      <p><strong>Defeito relatado:</strong> ${escapeHtml(data.defeitoRelatado)}</p>
      <p><strong>Serviço solicitado:</strong> ${escapeHtml(data.servicoSolicitado)}</p>
      <p><strong>Acessórios entregues:</strong> ${escapeHtml(data.acessorios)}</p>
      <p><strong>Prazo estimado:</strong> ${escapeHtml(data.prazo)}</p>
      <p><strong>Valor estimado:</strong> ${escapeHtml(data.valorEstimado)}</p>
      <p><strong>Observações:</strong> ${escapeHtml(data.observacoes)}</p>
    </div>
  `;
}

function buildReceiptPrintMarkup(receipt) {
  return `
    <div class="print-header">
      <h1>${COMPANY_NAME}</h1>
      <h2>Comprovante de Venda</h2>
      <p>Venda: #${escapeHtml(receipt.id)}</p>
      <p>Data: ${formatDateTime(receipt.createdAt)}</p>
      <p>Pagamento: ${escapeHtml(receipt.paymentMethod)}</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>Produto</th>
          <th>Qtd.</th>
          <th>Unitário</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${receipt.items.map((item) => `
          <tr>
            <td>${escapeHtml(item.nome)}</td>
            <td>${safeNumber(item.quantidade)}</td>
            <td>${formatMoney(item.preco)}</td>
            <td>${formatMoney(item.total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="print-total">Total: ${formatMoney(receipt.total)}</div>
  `;
}

function buildConsultarProdutosPrintMarkup() {
  return `
    <div class="print-header">
      <h1>${COMPANY_NAME}</h1>
      <h2>Consulta de Produtos</h2>
      <p>Data: ${formatDateTime(new Date().toISOString())}</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Produto</th>
          <th>Estoque</th>
          <th>Preço</th>
        </tr>
      </thead>
      <tbody>
        ${state.produtos.length === 0
          ? '<tr><td colspan="4">Nenhum produto cadastrado.</td></tr>'
          : state.produtos.map((product) => `
              <tr>
                <td>${escapeHtml(product.codigo)}</td>
                <td>${escapeHtml(product.nome)}</td>
                <td>${safeNumber(product.estoque_atual)}</td>
                <td>${formatMoney(product.preco_venda)}</td>
              </tr>
            `).join('')}
      </tbody>
    </table>
  `;
}

function buildMeusPedidosPrintMarkup() {
  const rows = state.receitas.slice(0, 10);

  return `
    <div class="print-header">
      <h1>${COMPANY_NAME}</h1>
      <h2>Meus Pedidos</h2>
      <p>Data: ${formatDateTime(new Date().toISOString())}</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Descrição</th>
          <th>Data</th>
          ${shouldShowSellerInfo() ? '<th>Vendedor</th>' : ''}
          <th>Status</th>
          <th>Valor</th>
          <th>Registro</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length === 0
          ? `<tr><td colspan="${shouldShowSellerInfo() ? 7 : 6}">Nenhuma venda registrada.</td></tr>`
          : rows.map((item) => `
              <tr>
                <td>#${item.id}</td>
                <td>${escapeHtml(item.descricao)}</td>
                <td>${formatDate(item.data)}</td>
                ${shouldShowSellerInfo() ? `<td>${escapeHtml(sellerDisplayName(item))}</td>` : ''}
                <td>${escapeHtml(item.status)}</td>
                <td>${formatMoney(item.valor)}</td>
                <td>${formatDateTime(item.criado_em || item.data)}</td>
              </tr>
            `).join('')}
      </tbody>
    </table>
  `;
}

function buildRelatoriosVendasPrintMarkup() {
  const dre = state.dre || {};
  const recentSales = state.receitas.slice(0, 10);

  return `
    <div class="print-header">
      <h1>${COMPANY_NAME}</h1>
      <h2>Relatórios de Vendas</h2>
      <p>Data: ${formatDateTime(new Date().toISOString())}</p>
    </div>
    <div class="print-grid">
      <div class="print-card">
        <h3>DRE</h3>
        <p><strong>Receita Bruta:</strong> ${formatMoney(dre.receita_bruta)}</p>
        <p><strong>Despesas Totais:</strong> ${formatMoney(dre.despesas_totais)}</p>
        <p><strong>Resultado:</strong> ${formatMoney(dre.resultado)}</p>
        <p><strong>Margem:</strong> ${safeNumber(dre.margem)}%</p>
      </div>
      <div class="print-card">
        <h3>Top Produtos</h3>
        ${state.topProdutos.length === 0
          ? '<p>Nenhum dado disponível.</p>'
          : `<table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Saídas</th>
                </tr>
              </thead>
              <tbody>
                ${state.topProdutos.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.nome)}</td>
                    <td>${safeNumber(item.saidas)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Valor</th>
          <th>Vendedor</th>
          <th>Data</th>
        </tr>
      </thead>
      <tbody>
        ${recentSales.length === 0
          ? '<tr><td colspan="4">Nenhuma venda registrada.</td></tr>'
          : recentSales.map((item) => `
              <tr>
                <td>#${item.id}</td>
                <td>${formatMoney(item.valor)}</td>
                <td>${escapeHtml(sellerDisplayName(item))}</td>
                <td>${formatDateTime(item.criado_em || item.data)}</td>
              </tr>
            `).join('')}
      </tbody>
    </table>
  `;
}

function findProductById(productId) {
  return state.produtos.find((product) => Number(product.id) === Number(productId));
}

function buildMonthlySeries(transactions, months = 8) {
  const result = [];
  const now = new Date();

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = date.getFullYear();
    const month = date.getMonth();
    const label = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

    const total = transactions.reduce((sum, item) => {
      if (!item.data || item.status === 'cancelado') {
        return sum;
      }

      const txDate = new Date(item.data);
      if (txDate.getFullYear() === year && txDate.getMonth() === month) {
        return sum + safeNumber(item.valor);
      }

      return sum;
    }, 0);

    result.push({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      total,
    });
  }

  return result;
}

function buildTopProductsSeries() {
  const grouped = new Map();

  state.movimentos
    .filter((item) => item.tipo === 'saida')
    .forEach((item) => {
      const key = item.produto_nome || `Produto ${item.produto_id}`;
      grouped.set(key, (grouped.get(key) || 0) + safeNumber(item.quantidade));
    });

  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function setElementText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function renderPedidoTable() {
  const tbody = document.getElementById('itens-pedido');
  if (!tbody) return;

  if (state.currentSale.items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-table-message">Nenhum item adicionado ao pedido.</td>
      </tr>
      <tr class="total-row">
        <td colspan="3"><strong>Total:</strong></td>
        <td><strong>${formatMoney(0)}</strong></td>
      </tr>
    `;
  } else {
    tbody.innerHTML = `
      ${state.currentSale.items.map((item, index) => `
        <tr>
          <td>
            <div>${escapeHtml(item.nome)}</div>
            <button class="btn-inline-danger" onclick="removerItemVenda(${index})">Remover</button>
          </td>
          <td>${safeNumber(item.quantidade)}</td>
          <td>${formatMoney(item.preco)}</td>
          <td>${formatMoney(item.total)}</td>
        </tr>
      `).join('')}
      <tr class="total-row">
        <td colspan="3"><strong>Total:</strong></td>
        <td><strong>${formatMoney(getSaleTotal())}</strong></td>
      </tr>
    `;
  }

  setElementText('resumo-venda-total', `Total: ${formatMoney(getSaleTotal())}`);
  setElementText('resumo-venda-pagamento', `Forma de Pagamento: ${state.currentSale.paymentMethod}`);
}

function renderRecentOrders() {
  const container = document.getElementById('ultimos-pedidos');
  if (!container) return;

  if (state.receitas.length === 0) {
    container.innerHTML = '<div class="pedido-item pedido-empty">Nenhuma venda registrada ainda.</div>';
    return;
  }

  container.innerHTML = state.receitas.slice(0, 5).map((item) => `
    <div class="pedido-item">
      <div>
        <span class="pedido-num">#${item.id}</span>
        ${shouldShowSellerInfo() ? `<span>${escapeHtml(sellerDisplayName(item))}</span>` : ''}
      </div>
      <span class="pedido-valor">${formatMoney(item.valor)}</span>
      <div class="pedido-icons">
        <span>${escapeHtml(item.status || 'pago')}</span>
        <span>${formatDateTime(item.criado_em || item.data)}</span>
      </div>
    </div>
  `).join('');
}

function renderProdutosAdmin() {
  const tbody = document.getElementById('produtos-admin');
  if (!tbody) return;

  if (state.produtos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; padding:20px; color:rgba(255,255,255,0.6);">
          Nenhum produto cadastrado
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.produtos.slice(0, 8).map((product) => `
    <tr>
      <td>${escapeHtml(product.nome)}</td>
      <td>${safeNumber(product.estoque_atual)}</td>
      <td>${formatMoney(product.preco_venda)}</td>
      <td>
        <button class="btn-action btn-edit" onclick="editarProduto(${product.id})">Editar</button>
        <button class="btn-action btn-delete" onclick="excluirProduto(${product.id})">Excluir</button>
      </td>
    </tr>
  `).join('');
}

function renderFinanceSummary() {
  const resumo = state.resumo || {};
  setElementText('resumo-receitas', formatMoney(resumo.total_receitas || 0));
  setElementText('resumo-despesas', formatMoney(resumo.total_despesas || 0));
  setElementText('vendas-dia-valor', formatMoney(getTodayRevenueTotal()));
  setElementText('vendas-mes-quantidade', String(getMonthSalesCount()));
}

function initCharts() {
  const monthlyRevenueSeries = buildMonthlySeries(state.receitas, 8);
  const monthlyExpenseSeries = buildMonthlySeries(state.despesas, 8);
  const topProducts = buildTopProductsSeries();

  const ctxMensais = document.getElementById('chart-vendas-mensais');
  if (ctxMensais) {
    if (chartVendasMensais) {
      chartVendasMensais.destroy();
    }

    chartVendasMensais = new Chart(ctxMensais, {
      type: 'bar',
      data: {
        labels: monthlyRevenueSeries.map((item) => item.label),
        datasets: [
          {
            label: 'Receitas',
            data: monthlyRevenueSeries.map((item) => item.total),
            backgroundColor: '#2196F3',
            borderRadius: 6,
          },
          {
            label: 'Despesas',
            data: monthlyExpenseSeries.map((item) => item.total),
            backgroundColor: '#EF5350',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: 'rgba(255,255,255,0.8)' } },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${formatMoney(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: 'rgba(255,255,255,0.7)',
              callback(value) {
                return formatMoney(value);
              },
            },
            grid: { color: 'rgba(255,255,255,0.1)' },
          },
          x: {
            ticks: { color: 'rgba(255,255,255,0.7)' },
            grid: { display: false },
          },
        },
      },
    });
  }

  const ctxRelatorio = document.getElementById('chart-relatorio-vendas');
  if (ctxRelatorio) {
    if (chartRelatorioVendas) {
      chartRelatorioVendas.destroy();
    }

    chartRelatorioVendas = new Chart(ctxRelatorio, {
      type: 'bar',
      data: {
        labels: topProducts.map((item) => item[0]),
        datasets: [{
          label: 'Saídas',
          data: topProducts.map((item) => item[1]),
          backgroundColor: '#42A5F5',
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: 'rgba(255,255,255,0.7)' },
            grid: { color: 'rgba(255,255,255,0.1)' },
          },
          x: {
            ticks: { color: 'rgba(255,255,255,0.7)' },
            grid: { display: false },
          },
        },
      },
    });
  }
}

function renderDashboard() {
  renderPedidoTable();
  renderRecentOrders();
  renderProdutosAdmin();
  renderFinanceSummary();
  initCharts();
}

function applyDashboardAccess() {
  const app = document.getElementById('app');
  const vendedorPanel = document.getElementById('panel-vendedor');
  const adminPanel = document.getElementById('panel-admin');
  const adminTitle = document.getElementById('admin-panel-title');
  const adminContent = document.getElementById('admin-panel-content');

  if (!app || !vendedorPanel || !adminPanel || !adminTitle || !adminContent) {
    return;
  }

  adminTitle.textContent = 'Painel Administrativo';

  if (defaultAdminPanelMarkup && !adminContent.querySelector('#produtos-admin')) {
    adminContent.innerHTML = defaultAdminPanelMarkup;
  }

  if (hasAdminDashboard()) {
    app.style.gridTemplateColumns = '1fr';
    vendedorPanel.style.display = 'none';
    adminPanel.style.display = 'flex';
    return;
  }

  app.style.gridTemplateColumns = '1fr';
  vendedorPanel.style.display = 'flex';
  adminPanel.style.display = 'none';
}

async function loadTenantUsers() {
  if (!hasAdminDashboard()) {
    state.tenantUsers = [];
    return [];
  }

  const users = await api('GET', '/empresa/usuarios');
  state.tenantUsers = Array.isArray(users) ? users : [];
  return state.tenantUsers;
}

function renderTenantUsersSection() {
  if (!hasAdminDashboard()) {
    return '';
  }

  return `
    <div class="report-card">
      <h3>Usuários da Empresa</h3>
      <form id="tenant-user-form" class="modal-form">
        <div class="modal-grid">
          <div class="form-group">
            <label for="tenant-user-name">Nome</label>
            <input id="tenant-user-name" placeholder="Nome do usuário" required>
          </div>
          <div class="form-group">
            <label for="tenant-user-username">Login</label>
            <input id="tenant-user-username" placeholder="login" required>
          </div>
        </div>
        <div class="modal-grid">
          <div class="form-group">
            <label for="tenant-user-password">Senha</label>
            <input id="tenant-user-password" placeholder="Senha inicial" required>
          </div>
          <div class="form-group">
            <label for="tenant-user-role">Perfil</label>
            <select id="tenant-user-role">
              <option value="gerente">Gerente</option>
              <option value="operador">Operador</option>
            </select>
          </div>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-green">Cadastrar Usuário</button>
        </div>
      </form>
      <div class="table-wrapper">
        <table class="modal-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Login</th>
              <th>Perfil</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${state.tenantUsers.length === 0
              ? '<tr><td colspan="5" class="empty-table-message">Nenhum usuário cadastrado.</td></tr>'
              : state.tenantUsers.map((tenantUser) => `
                  <tr>
                    <td>${escapeHtml(tenantUser.nome)}</td>
                    <td>${escapeHtml(tenantUser.username)}</td>
                    <td>${escapeHtml(tenantUser.role)}</td>
                    <td>${tenantUser.ativo ? 'Ativo' : 'Inativo'}</td>
                    <td>
                      ${tenantUser.role === 'admin'
                        ? '<span>Principal</span>'
                        : `
                          <button class="btn-action btn-edit" onclick="toggleTenantUserStatus(${tenantUser.id})">
                            ${tenantUser.ativo ? 'Desativar' : 'Ativar'}
                          </button>
                          <button class="btn-action btn-delete" onclick="resetTenantUserPassword(${tenantUser.id})">
                            Nova Senha
                          </button>
                        `}
                    </td>
                  </tr>
                `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAdminPasswordSection() {
  if (!hasAdminDashboard()) {
    return '';
  }

  return `
    <div class="report-card">
      <h3>Alterar Minha Senha</h3>
      <form id="admin-password-form" class="modal-form">
        <div class="form-group">
          <label for="admin-current-password">Senha Atual</label>
          <input id="admin-current-password" type="password" autocomplete="current-password" required>
        </div>
        <div class="modal-grid">
          <div class="form-group">
            <label for="admin-new-password">Nova Senha</label>
            <input id="admin-new-password" type="password" autocomplete="new-password" required>
          </div>
          <div class="form-group">
            <label for="admin-confirm-password">Confirmar Nova Senha</label>
            <input id="admin-confirm-password" type="password" autocomplete="new-password" required>
          </div>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-green">Alterar Minha Senha</button>
        </div>
      </form>
    </div>
  `;
}

function attachTenantUserForm() {
  const form = document.getElementById('tenant-user-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      nome: document.getElementById('tenant-user-name').value.trim(),
      username: document.getElementById('tenant-user-username').value.trim(),
      senha: document.getElementById('tenant-user-password').value.trim(),
      role: document.getElementById('tenant-user-role').value,
    };

    if (!payload.nome || !payload.username || !payload.senha) {
      showToast('Preencha todos os campos do usuário.', 'error');
      return;
    }

    try {
      await api('POST', '/empresa/usuarios', payload);
      await loadTenantUsers();
      configSistema();
      showToast('Usuário cadastrado com sucesso.', 'success');
    } catch (error) {
      console.error('Erro ao cadastrar usuario:', error);
      showToast(error.message || 'Erro ao cadastrar usuário.', 'error');
    }
  });
}

async function toggleTenantUserStatus(id) {
  const tenantUser = state.tenantUsers.find((item) => item.id === id);
  if (!tenantUser) {
    showToast('Usuário não encontrado.', 'error');
    return;
  }

  try {
    await api('PUT', `/empresa/usuarios/${id}/status`, { ativo: !tenantUser.ativo });
    await loadTenantUsers();
    configSistema();
    showToast(`Usuário ${tenantUser.ativo ? 'desativado' : 'ativado'} com sucesso.`, 'success');
  } catch (error) {
    console.error('Erro ao atualizar usuario:', error);
    showToast(error.message || 'Erro ao atualizar usuário.', 'error');
  }
}

async function resetTenantUserPassword(id) {
  const tenantUser = state.tenantUsers.find((item) => item.id === id);
  if (!tenantUser) {
    showToast('Usuário não encontrado.', 'error');
    return;
  }

  const senha = window.prompt(`Digite a nova senha para ${tenantUser.username}:`);
  if (!senha) {
    return;
  }

  try {
    await api('PUT', `/empresa/usuarios/${id}/senha`, { senha });
    showToast('Senha redefinida com sucesso.', 'success');
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    showToast(error.message || 'Erro ao redefinir senha.', 'error');
  }
}

async function refreshDashboard(showFeedback = false) {
  try {
    const [
      produtos,
      receitas,
      despesas,
      movimentos,
      resumo,
      dre,
      topProdutos,
      auditLog,
    ] = await Promise.all([
      api('GET', '/produtos'),
      api('GET', '/transacoes?tipo=receita'),
      api('GET', '/transacoes?tipo=despesa'),
      api('GET', '/movimentos'),
      api('GET', '/dashboard/resumo'),
      api('GET', '/relatorios/dre'),
      api('GET', '/relatorios/top-produtos'),
      api('GET', '/relatorios/audit-log'),
    ]);

    state.produtos = Array.isArray(produtos) ? produtos : [];
    state.receitas = Array.isArray(receitas) ? receitas : [];
    state.despesas = Array.isArray(despesas) ? despesas : [];
    state.movimentos = Array.isArray(movimentos) ? movimentos : [];
    state.resumo = resumo || null;
    state.dre = dre || null;
    state.topProdutos = Array.isArray(topProdutos) ? topProdutos : [];
    state.auditLog = Array.isArray(auditLog) ? auditLog : [];

    renderDashboard();

    if (showFeedback) {
      showToast('Painel atualizado com sucesso.', 'success');
    }
  } catch (error) {
    console.error('Erro ao atualizar painel:', error);
      showToast(error.message || 'Erro ao carregar dados do painel.', 'error');
  }
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('auth-error');

  errEl.style.display = 'none';

  if (!username || !password) {
    errEl.textContent = 'Preencha todos os campos.';
    errEl.style.display = 'block';
    return;
  }

  try {
    const form = new FormData();
    form.append('username', username);
    form.append('password', password);

    const data = await apiForm('/auth/login', form);
    authToken = data.access_token;
    currentUser = data.usuario;

    localStorage.setItem('vendas_token', authToken);
    localStorage.setItem('vendas_user', JSON.stringify(currentUser));

    await initApp();
  } catch (error) {
    errEl.textContent = error.message || 'UsuÃ¡rio ou senha invÃ¡lidos.';
    errEl.style.display = 'block';
  }
}

function doLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('vendas_token');
  localStorage.removeItem('vendas_user');
  state.currentSale = { items: [], paymentMethod: 'Cartão' };
  state.lastReceipt = null;

  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

async function initApp() {
  if (!hasAdminDashboard() && !hasSalesDashboard()) {
    doLogout();
    return;
  }

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'grid';
  applyDashboardAccess();
  renderPedidoTable();
  await refreshDashboard();
  showToast(`Bem-vindo, ${currentUser?.nome || 'usuário'}!`, 'success');
}

function getProductOptionsHtml(selectedId = '') {
  return state.produtos.map((product) => `
    <option value="${product.id}" ${String(selectedId) === String(product.id) ? 'selected' : ''}>
      ${escapeHtml(product.nome)} (${safeNumber(product.estoque_atual)} em estoque)
    </option>
  `).join('');
}

function novaVenda() {
  if (state.produtos.length === 0) {
    showToast('Cadastre produtos antes de iniciar uma venda.', 'error');
    return;
  }

  openModal(`
    <div class="modal-header">
      <h2>Nova Venda</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <form id="sale-item-form" class="modal-form">
      <div class="modal-grid">
        <div class="form-group">
          <label for="sale-product">Produto</label>
          <select id="sale-product" required>
            ${getProductOptionsHtml()}
          </select>
        </div>
        <div class="form-group">
          <label for="sale-quantity">Quantidade</label>
          <input type="number" id="sale-quantity" min="1" step="1" value="1" required>
        </div>
      </div>
      <div class="form-group">
        <label for="sale-payment">Forma de Pagamento</label>
        <select id="sale-payment">
          <option value="Cartão">Cartão</option>
          <option value="Pix">Pix</option>
          <option value="Dinheiro">Dinheiro</option>
          <option value="Boleto">Boleto</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-blue">Adicionar ao Pedido</button>
        <button type="button" class="btn btn-outline-blue" onclick="closeModal()">Fechar</button>
      </div>
    </form>
    <div class="modal-section">
      <h3>Itens atuais</h3>
      <div class="modal-list">
        ${state.currentSale.items.length === 0
          ? '<p class="empty-message">Nenhum item no pedido atual.</p>'
          : state.currentSale.items.map((item, index) => `
              <div class="modal-list-item">
                <div>
                  <strong>${escapeHtml(item.nome)}</strong>
                  <span>${safeNumber(item.quantidade)} x ${formatMoney(item.preco)}</span>
                </div>
                <button class="btn-inline-danger" onclick="removerItemVenda(${index}); novaVenda();">Remover</button>
              </div>
            `).join('')}
      </div>
    </div>
  `);

  const form = document.getElementById('sale-item-form');
  const paymentField = document.getElementById('sale-payment');
  paymentField.value = state.currentSale.paymentMethod;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    adicionarItemVenda();
  });
}

function adicionarItemVenda() {
  const productId = Number(document.getElementById('sale-product').value);
  const quantity = safeNumber(document.getElementById('sale-quantity').value);
  const paymentMethod = document.getElementById('sale-payment').value;
  const product = findProductById(productId);

  if (!product) {
    showToast('Produto não encontrado.', 'error');
    return;
  }

  if (quantity <= 0) {
    showToast('Informe uma quantidade válida.', 'error');
    return;
  }

  if (quantity > safeNumber(product.estoque_atual)) {
    showToast(`Estoque insuficiente para ${product.nome}.`, 'error');
    return;
  }

  const existingItem = state.currentSale.items.find((item) => Number(item.id) === productId);

  if (existingItem) {
    const updatedQuantity = existingItem.quantidade + quantity;
    if (updatedQuantity > safeNumber(product.estoque_atual)) {
      showToast(`Quantidade total ultrapassa o estoque disponÃ­vel para ${product.nome}.`, 'error');
      return;
    }
    existingItem.quantidade = updatedQuantity;
    existingItem.total = existingItem.quantidade * existingItem.preco;
  } else {
    state.currentSale.items.push({
      id: product.id,
      codigo: product.codigo,
      nome: product.nome,
      quantidade: quantity,
      preco: safeNumber(product.preco_venda),
      custo: safeNumber(product.custo),
      total: safeNumber(product.preco_venda) * quantity,
    });
  }

  state.currentSale.paymentMethod = paymentMethod;
  renderPedidoTable();
  showToast(`${product.nome} adicionado ao pedido.`, 'success');
  novaVenda();
}

function removerItemVenda(index) {
  state.currentSale.items.splice(index, 1);
  renderPedidoTable();
}

function consultarProdutos() {
  const rows = state.produtos.length === 0
    ? '<p class="empty-message">Nenhum produto cadastrado.</p>'
    : `
        <div class="table-wrapper">
          <table class="modal-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Estoque</th>
                <th>Preço</th>
              </tr>
            </thead>
            <tbody>
              ${state.produtos.map((product) => `
                <tr>
                  <td>${escapeHtml(product.codigo)}</td>
                  <td>${escapeHtml(product.nome)}</td>
                  <td>${safeNumber(product.estoque_atual)}</td>
                  <td>${formatMoney(product.preco_venda)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

  openModal(`
    <div class="modal-header">
      <h2>Consultar Produtos</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    ${rows}
    <div class="modal-actions">
      <button class="btn btn-blue" onclick="imprimirConsultarProdutos()">Imprimir</button>
    </div>
  `);
}

function attachAdminPasswordForm() {
  const form = document.getElementById('admin-password-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      senha_atual: document.getElementById('admin-current-password').value,
      nova_senha: document.getElementById('admin-new-password').value,
      confirmar_senha: document.getElementById('admin-confirm-password').value,
    };

    if (!payload.senha_atual || !payload.nova_senha || !payload.confirmar_senha) {
      showToast('Preencha todos os campos para alterar sua senha.', 'error');
      return;
    }

    if (payload.nova_senha !== payload.confirmar_senha) {
      showToast('A confirmação da nova senha não confere.', 'error');
      return;
    }

    try {
      await api('PUT', '/empresa/admin/minha-senha', payload);
      form.reset();
      showToast('Senha alterada com sucesso.', 'success');
    } catch (error) {
      console.error('Erro ao alterar a própria senha:', error);
      showToast(error.message || 'Erro ao alterar a própria senha.', 'error');
    }
  });
}

function imprimirConsultarProdutos() {
  openPrintWindow('Consulta de Produtos - JM MULT CELL', buildConsultarProdutosPrintMarkup());
}

function meusPedidos() {
  const rows = state.receitas.slice(0, 10);
  const showSellerColumn = shouldShowSellerInfo();
  openModal(`
    <div class="modal-header">
      <h2>Meus Pedidos</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <div class="table-wrapper">
      <table class="modal-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Descrição</th>
            <th>Data</th>
            ${showSellerColumn ? '<th>Vendedor</th>' : ''}
            <th>Status</th>
            <th>Valor</th>
            <th>Registro</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0
            ? `<tr><td colspan="${showSellerColumn ? 7 : 6}" class="empty-table-message">Nenhuma venda registrada.</td></tr>`
            : rows.map((item) => `
                <tr>
                  <td>#${item.id}</td>
                  <td>${escapeHtml(item.descricao)}</td>
                  <td>${formatDate(item.data)}</td>
                  ${showSellerColumn ? `<td>${escapeHtml(sellerDisplayName(item))}</td>` : ''}
                  <td>${escapeHtml(item.status)}</td>
                  <td>${formatMoney(item.valor)}</td>
                  <td>${formatDateTime(item.criado_em || item.data)}</td>
                </tr>
              `).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-blue" onclick="imprimirMeusPedidos()">Imprimir</button>
    </div>
  `);
}

function imprimirMeusPedidos() {
  openPrintWindow('Meus Pedidos - JM MULT CELL', buildMeusPedidosPrintMarkup());
}

function historicoVendas() {
  meusPedidos();
}

async function finalizarVenda() {
  if (state.currentSale.items.length === 0) {
    showToast('Adicione ao menos um item antes de finalizar a venda.', 'error');
    return;
  }

  const total = getSaleTotal();
  const descricao = `Venda (${state.currentSale.paymentMethod}) - ${state.currentSale.items
    .map((item) => `${item.nome} x${item.quantidade}`)
    .join(', ')}`;

  try {
    const transacao = await api('POST', '/transacoes', {
      tipo: 'receita',
      descricao,
      valor: total,
      data: todayIsoDate(),
      status: 'pago',
      observacao: JSON.stringify({
        forma_pagamento: state.currentSale.paymentMethod,
        itens: state.currentSale.items,
      }),
    });

    for (const item of state.currentSale.items) {
      await api('POST', '/movimentos', {
        produto_id: item.id,
        tipo: 'saida',
        quantidade: item.quantidade,
        custo_unitario: item.custo,
        observacao: `Venda #${transacao.id}`,
      });
    }

    state.lastReceipt = {
      id: transacao.id,
      total,
      paymentMethod: state.currentSale.paymentMethod,
      items: [...state.currentSale.items],
      createdAt: new Date().toISOString(),
    };

    state.currentSale = {
      items: [],
      paymentMethod: 'Cartão',
    };

    closeModal();
    renderPedidoTable();
    await refreshDashboard();
    showToast('Venda finalizada com sucesso!', 'success');
  } catch (error) {
    console.error('Erro ao finalizar venda:', error);
    showToast(error.message || 'Não foi possível finalizar a venda.', 'error');
  }
}

function gerarComprovante() {
  const receipt = state.lastReceipt || {
    id: 'Prévia',
    total: getSaleTotal(),
    paymentMethod: state.currentSale.paymentMethod,
    items: state.currentSale.items,
    createdAt: new Date().toISOString(),
  };

  if (!receipt.items || receipt.items.length === 0) {
    showToast('Não há venda para gerar comprovante.', 'error');
    return;
  }

  openModal(`
    <div class="modal-header">
      <h2>Comprovante de Venda</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <div class="receipt-card">
      <p><strong>Venda:</strong> #${escapeHtml(receipt.id)}</p>
      <p><strong>Data:</strong> ${formatDateTime(receipt.createdAt)}</p>
      <p><strong>Pagamento:</strong> ${escapeHtml(receipt.paymentMethod)}</p>
      <div class="table-wrapper">
        <table class="modal-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Qtd.</th>
              <th>Unitário</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${receipt.items.map((item) => `
              <tr>
                <td>${escapeHtml(item.nome)}</td>
                <td>${safeNumber(item.quantidade)}</td>
                <td>${formatMoney(item.preco)}</td>
                <td>${formatMoney(item.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="receipt-total"><strong>Total:</strong> ${formatMoney(receipt.total)}</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-blue" onclick="imprimirComprovante()">Imprimir</button>
    </div>
  `);
}

function imprimirComprovante() {
  const receipt = state.lastReceipt || {
    id: 'Prévia',
    total: getSaleTotal(),
    paymentMethod: state.currentSale.paymentMethod,
    items: state.currentSale.items,
    createdAt: new Date().toISOString(),
  };

  if (!receipt.items || receipt.items.length === 0) {
    showToast('Não há comprovante para imprimir.', 'error');
    return;
  }

  openPrintWindow('Comprovante de Venda - JM MULT CELL', buildReceiptPrintMarkup(receipt));
}

function gerenciarProdutos() {
  openModal(`
    <div class="modal-header">
      <h2>Gerenciar Produtos</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-green" onclick="abrirFormularioProduto()">Novo Produto</button>
      <button class="btn btn-blue" onclick="refreshDashboard(true)">Atualizar Lista</button>
      <button class="btn btn-blue" onclick="imprimirConsultarProdutos()">Imprimir</button>
    </div>
    <div class="table-wrapper">
      <table class="modal-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome</th>
            <th>Estoque</th>
            <th>Preço</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${state.produtos.length === 0
            ? '<tr><td colspan="5" class="empty-table-message">Nenhum produto cadastrado.</td></tr>'
            : state.produtos.map((product) => `
                <tr>
                  <td>${escapeHtml(product.codigo)}</td>
                  <td>${escapeHtml(product.nome)}</td>
                  <td>${safeNumber(product.estoque_atual)}</td>
                  <td>${formatMoney(product.preco_venda)}</td>
                  <td>
                    <button class="btn-action btn-edit" onclick="editarProduto(${product.id})">Editar</button>
                    <button class="btn-action btn-delete" onclick="excluirProduto(${product.id})">Excluir</button>
                  </td>
                </tr>
              `).join('')}
        </tbody>
      </table>
    </div>
  `);
}

function buildProdutoForm(product = null) {
  const isEdit = Boolean(product);
  return `
    <div class="modal-header">
      <h2>${isEdit ? 'Editar Produto' : 'Novo Produto'}</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <form id="product-form" class="modal-form">
      <div class="modal-grid">
        <div class="form-group">
          <label for="produto-codigo">Código</label>
          <input id="produto-codigo" value="${escapeHtml(product?.codigo || '')}" required>
        </div>
        <div class="form-group">
          <label for="produto-nome">Nome</label>
          <input id="produto-nome" value="${escapeHtml(product?.nome || '')}" required>
        </div>
      </div>
      <div class="form-group">
        <label for="produto-descricao">DescriÃ§Ã£o</label>
        <textarea id="produto-descricao" rows="3">${escapeHtml(product?.descricao || '')}</textarea>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="produto-estoque">Estoque Atual</label>
          <input id="produto-estoque" type="number" step="0.01" value="${safeNumber(product?.estoque_atual)}" required>
        </div>
        <div class="form-group">
          <label for="produto-estoque-minimo">Estoque MÃ­nimo</label>
          <input id="produto-estoque-minimo" type="number" step="0.01" value="${safeNumber(product?.estoque_minimo)}" required>
        </div>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="produto-custo">Custo</label>
          <input id="produto-custo" type="number" step="0.01" value="${safeNumber(product?.custo)}" required>
        </div>
        <div class="form-group">
          <label for="produto-preco">Preço de Venda</label>
          <input id="produto-preco" type="number" step="0.01" value="${safeNumber(product?.preco_venda)}" required>
        </div>
      </div>
      <div class="form-group">
        <label for="produto-unidade">Unidade</label>
        <input id="produto-unidade" value="${escapeHtml(product?.unidade || 'un')}" required>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-green">${isEdit ? 'Salvar Alterações' : 'Cadastrar Produto'}</button>
        <button type="button" class="btn btn-outline-blue" onclick="gerenciarProdutos()">Voltar</button>
      </div>
    </form>
  `;
}

function abrirFormularioProduto() {
  openModal(buildProdutoForm());
  attachProductFormHandler();
}

function attachProductFormHandler(productId = null) {
  const form = document.getElementById('product-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      codigo: document.getElementById('produto-codigo').value.trim(),
      nome: document.getElementById('produto-nome').value.trim(),
      descricao: document.getElementById('produto-descricao').value.trim(),
      estoque_atual: safeNumber(document.getElementById('produto-estoque').value),
      estoque_minimo: safeNumber(document.getElementById('produto-estoque-minimo').value),
      custo: safeNumber(document.getElementById('produto-custo').value),
      preco_venda: safeNumber(document.getElementById('produto-preco').value),
      unidade: document.getElementById('produto-unidade').value.trim() || 'un',
    };

    if (!payload.codigo || !payload.nome) {
      showToast('Código e nome sÃ£o obrigatÃ³rios.', 'error');
      return;
    }

    try {
      if (productId) {
        await api('PUT', `/produtos/${productId}`, payload);
        showToast('Produto atualizado com sucesso.', 'success');
      } else {
        await api('POST', '/produtos', payload);
        showToast('Produto cadastrado com sucesso.', 'success');
      }

      await refreshDashboard();
      gerenciarProdutos();
    } catch (error) {
      console.error('Erro ao salvar produto:', error);
      showToast(error.message || 'Erro ao salvar produto.', 'error');
    }
  });
}

function editarProduto(id) {
  const product = findProductById(id);
  if (!product) {
    showToast('Produto não encontrado.', 'error');
    return;
  }

  openModal(buildProdutoForm(product));
  attachProductFormHandler(id);
}

async function excluirProduto(id) {
  const product = findProductById(id);
  if (!product) {
    showToast('Produto não encontrado.', 'error');
    return;
  }

  if (!window.confirm(`Deseja realmente excluir o produto "${product.nome}"?`)) {
    return;
  }

  try {
    await api('DELETE', `/produtos/${id}`);
    await refreshDashboard();
    gerenciarProdutos();
    showToast('Produto excluÃ­do com sucesso.', 'success');
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    showToast(error.message || 'Erro ao excluir produto.', 'error');
  }
}

function alterarPrecos() {
  openModal(`
    <div class="modal-header">
      <h2>Alterar Preços</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <form id="price-form" class="modal-form">
      <div class="table-wrapper">
        <table class="modal-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Preço Atual</th>
              <th>Novo Preço</th>
            </tr>
          </thead>
          <tbody>
            ${state.produtos.length === 0
              ? '<tr><td colspan="3" class="empty-table-message">Nenhum produto cadastrado.</td></tr>'
              : state.produtos.map((product) => `
                  <tr>
                    <td>${escapeHtml(product.nome)}</td>
                    <td>${formatMoney(product.preco_venda)}</td>
                    <td>
                      <input class="price-input" type="number" step="0.01" data-product-id="${product.id}" value="${safeNumber(product.preco_venda)}">
                    </td>
                  </tr>
                `).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-green">Salvar Preços</button>
      </div>
    </form>
  `);

  const form = document.getElementById('price-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const inputs = [...document.querySelectorAll('.price-input')];
      for (const input of inputs) {
        const product = findProductById(Number(input.dataset.productId));
        if (!product) continue;

        const newPrice = safeNumber(input.value);
        if (newPrice !== safeNumber(product.preco_venda)) {
          await api('PUT', `/produtos/${product.id}`, {
            codigo: product.codigo,
            nome: product.nome,
            descricao: product.descricao || '',
            estoque_atual: safeNumber(product.estoque_atual),
            estoque_minimo: safeNumber(product.estoque_minimo),
            custo: safeNumber(product.custo),
            preco_venda: newPrice,
            unidade: product.unidade || 'un',
          });
        }
      }

      await refreshDashboard();
      showToast('Preços atualizados com sucesso.', 'success');
      closeModal();
    } catch (error) {
      console.error('Erro ao alterar Preços:', error);
      showToast(error.message || 'Erro ao alterar Preços.', 'error');
    }
  });
}

function controleEstoque() {
  const showActorColumn = hasAdminDashboard();
  openModal(`
    <div class="modal-header">
      <h2>Controle de Estoque</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <form id="stock-form" class="modal-form">
      <div class="modal-grid">
        <div class="form-group">
          <label for="movimento-produto">Produto</label>
          <select id="movimento-produto">${getProductOptionsHtml()}</select>
        </div>
        <div class="form-group">
          <label for="movimento-tipo">Tipo</label>
          <select id="movimento-tipo">
            <option value="entrada">Entrada</option>
            <option value="saida">SaÃ­da</option>
          </select>
        </div>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="movimento-quantidade">Quantidade</label>
          <input type="number" id="movimento-quantidade" step="0.01" value="1" required>
        </div>
        <div class="form-group">
          <label for="movimento-custo">Custo Unitário</label>
          <input type="number" id="movimento-custo" step="0.01" value="0">
        </div>
      </div>
      <div class="form-group">
        <label for="movimento-observacao">Observações</label>
        <input id="movimento-observacao" placeholder="Motivo do ajuste de estoque">
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-green">Registrar Movimento</button>
      </div>
    </form>
    <div class="table-wrapper">
      <table class="modal-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Produto</th>
            <th>Tipo</th>
            <th>Qtd.</th>
            ${showActorColumn ? '<th>Responsável</th>' : ''}
            <th>Observações</th>
          </tr>
        </thead>
        <tbody>
          ${state.movimentos.length === 0
            ? `<tr><td colspan="${showActorColumn ? 6 : 5}" class="empty-table-message">Nenhum movimento registrado.</td></tr>`
            : state.movimentos.slice(0, 12).map((item) => `
                <tr>
                  <td>${formatDateTime(item.data_hora)}</td>
                  <td>${escapeHtml(item.produto_nome || '-')}</td>
                  <td>${escapeHtml(item.tipo)}</td>
                  <td>${safeNumber(item.quantidade)}</td>
                  ${showActorColumn ? `<td>${escapeHtml(actorDisplayName(item))}</td>` : ''}
                  <td>${escapeHtml(item.observacao || '-')}</td>
                </tr>
              `).join('')}
        </tbody>
      </table>
    </div>
  `);

  const form = document.getElementById('stock-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await api('POST', '/movimentos', {
        produto_id: Number(document.getElementById('movimento-produto').value),
        tipo: document.getElementById('movimento-tipo').value,
        quantidade: safeNumber(document.getElementById('movimento-quantidade').value),
        custo_unitario: safeNumber(document.getElementById('movimento-custo').value),
        observacao: document.getElementById('movimento-observacao').value.trim(),
      });

      await refreshDashboard();
      showToast('Movimento registrado com sucesso.', 'success');
      controleEstoque();
    } catch (error) {
      console.error('Erro ao registrar movimento:', error);
      showToast(error.message || 'Erro ao registrar movimento.', 'error');
    }
  });
}

function abrirDespesas() {
  const expenses = getCurrentMonthExpenses();
  const total = expenses.reduce((sum, item) => sum + safeNumber(item.valor), 0);
  const monthLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  openModal(`
    <div class="modal-header">
      <h2>Despesas</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <div class="report-card">
      <p><strong>Empresa:</strong> ${COMPANY_NAME}</p>
      <p><strong>Período:</strong> ${escapeHtml(monthLabel)}</p>
      <p><strong>Total do mês:</strong> ${formatMoney(total)}</p>
    </div>
    <div class="table-wrapper">
      <table class="modal-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Responsável</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          ${expenses.length === 0
            ? '<tr><td colspan="4" class="empty-table-message">Nenhuma despesa registrada no mês atual.</td></tr>'
            : expenses.map((item) => `
                <tr>
                  <td>${formatDate(item.data)}</td>
                  <td>${escapeHtml(item.descricao || '-')}</td>
                  <td>${escapeHtml(actorDisplayName(item))}</td>
                  <td>${formatMoney(item.valor)}</td>
                </tr>
              `).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-blue" onclick="imprimirDespesas()">Imprimir</button>
    </div>
  `);
}

function imprimirDespesas() {
  openPrintWindow('Despesas - JM MULT CELL', buildExpensePrintMarkup());
}

function abrirOrdemServico() {
  openModal(`
    <div class="modal-header">
      <h2>Ordem de Serviço</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <form id="service-order-form" class="modal-form">
      <div class="report-card">
        <p><strong>Empresa:</strong> ${COMPANY_NAME}</p>
        <p><strong>Segmento:</strong> Manutenção de celulares e acessórios em geral</p>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="os-cliente-nome">Nome do Cliente</label>
          <input id="os-cliente-nome" required>
        </div>
        <div class="form-group">
          <label for="os-cliente-telefone">Telefone</label>
          <input id="os-cliente-telefone">
        </div>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="os-aparelho-tipo">Tipo do Aparelho</label>
          <input id="os-aparelho-tipo" placeholder="Celular, tablet, acessório...">
        </div>
        <div class="form-group">
          <label for="os-aparelho-modelo">Marca / Modelo</label>
          <input id="os-aparelho-modelo">
        </div>
      </div>
      <div class="form-group">
        <label for="os-aparelho-serial">IMEI / Serial</label>
        <input id="os-aparelho-serial">
      </div>
      <div class="form-group">
        <label for="os-defeito">Defeito Relatado</label>
        <textarea id="os-defeito" rows="3"></textarea>
      </div>
      <div class="form-group">
          <label for="os-servico">Serviço Solicitado</label>
        <textarea id="os-servico" rows="3"></textarea>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="os-acessorios">Acessórios Entregues</label>
          <input id="os-acessorios">
        </div>
        <div class="form-group">
          <label for="os-prazo">Prazo Estimado</label>
          <input id="os-prazo">
        </div>
      </div>
      <div class="modal-grid">
        <div class="form-group">
          <label for="os-valor">Valor Estimado</label>
          <input id="os-valor">
        </div>
        <div class="form-group">
          <label for="os-observacoes">Observações</label>
          <input id="os-observacoes">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-blue" onclick="imprimirOrdemServico()">Imprimir</button>
      </div>
    </form>
  `);
}

function imprimirOrdemServico() {
  const data = {
    clienteNome: document.getElementById('os-cliente-nome')?.value.trim() || '-',
    clienteTelefone: document.getElementById('os-cliente-telefone')?.value.trim() || '-',
    aparelhoTipo: document.getElementById('os-aparelho-tipo')?.value.trim() || '-',
    aparelhoModelo: document.getElementById('os-aparelho-modelo')?.value.trim() || '-',
    aparelhoSerial: document.getElementById('os-aparelho-serial')?.value.trim() || '-',
    defeitoRelatado: document.getElementById('os-defeito')?.value.trim() || '-',
    servicoSolicitado: document.getElementById('os-servico')?.value.trim() || '-',
    acessorios: document.getElementById('os-acessorios')?.value.trim() || '-',
    prazo: document.getElementById('os-prazo')?.value.trim() || '-',
    valorEstimado: document.getElementById('os-valor')?.value.trim() || '-',
    observacoes: document.getElementById('os-observacoes')?.value.trim() || '-',
  };

  openPrintWindow('Ordem de Serviço - JM MULT CELL', buildServiceOrderPrintMarkup(data));
}

function relatoriosVendas() {
  const dre = state.dre || {};
  const recentSales = state.receitas.slice(0, 10);
  openModal(`
    <div class="modal-header">
      <h2>Relatórios de Vendas</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <div class="report-grid">
      <div class="report-card">
        <h3>DRE</h3>
        <p><strong>Receita Bruta:</strong> ${formatMoney(dre.receita_bruta)}</p>
        <p><strong>Despesas Totais:</strong> ${formatMoney(dre.despesas_totais)}</p>
        <p><strong>Resultado:</strong> ${formatMoney(dre.resultado)}</p>
        <p><strong>Margem:</strong> ${safeNumber(dre.margem)}%</p>
      </div>
      <div class="report-card">
        <h3>Top Produtos</h3>
        <ul class="report-list">
          ${(state.topProdutos.length === 0
            ? '<li>Nenhum dado disponível.</li>'
            : state.topProdutos.map((item) => `<li>${escapeHtml(item.nome)}: ${safeNumber(item.saidas)} Saídas</li>`).join(''))}
        </ul>
      </div>
    </div>
    <div class="report-card">
      <h3>Últimas Vendas</h3>
      <ul class="report-list">
        ${(recentSales.length === 0
          ? '<li>Nenhuma venda registrada.</li>'
          : recentSales.map((item) => `
              <li>#${item.id} - ${formatMoney(item.valor)} - ${escapeHtml(sellerDisplayName(item))} - ${formatDateTime(item.criado_em || item.data)}</li>
            `).join(''))}
      </ul>
    </div>
    <div class="report-card">
      <h3>Últimas Auditorias</h3>
      <ul class="report-list">
        ${(state.auditLog.length === 0
          ? '<li>Nenhum evento registrado.</li>'
          : state.auditLog.slice(0, 10).map((item) => `
              <li>${formatDateTime(item.data_hora)} - ${escapeHtml(actorDisplayName(item))} - ${escapeHtml(item.acao)} - ${escapeHtml(item.detalhe || '')}</li>
            `).join(''))}
      </ul>
    </div>
    <div class="modal-actions">
      <button class="btn btn-blue" onclick="imprimirRelatoriosVendas()">Imprimir</button>
    </div>
  `);
}

function imprimirRelatoriosVendas() {
  openPrintWindow('Relatórios de Vendas - JM MULT CELL', buildRelatoriosVendasPrintMarkup());
}

async function configSistema() {
  if (hasAdminDashboard()) {
    try {
      await loadTenantUsers();
    } catch (error) {
      console.error('Erro ao carregar usuarios da empresa:', error);
      showToast(error.message || 'Erro ao carregar usuários da empresa.', 'error');
    }
  }

  openModal(`
    <div class="modal-header">
      <h2>Configurações do Sistema</h2>
      <button class="modal-close" onclick="closeModal()">X</button>
    </div>
    <div class="report-card">
      <p><strong>Usuário:</strong> ${escapeHtml(currentUser?.nome || '-')}</p>
      <p><strong>Login:</strong> ${escapeHtml(currentUser?.username || '-')}</p>
      <p><strong>Perfil:</strong> ${escapeHtml(currentUser?.role || '-')}</p>
      <p><strong>Empresa:</strong> ${escapeHtml(currentUser?.slug || COMPANY_NAME)}</p>
    </div>
    ${renderAdminPasswordSection()}
    ${renderTenantUsersSection()}
    <div class="modal-actions">
      ${hasAdminDashboard() ? '<button class="btn btn-green" onclick="gerarBackupEmpresa()">Backup .db + .xlsx</button>' : ''}
      <button class="btn btn-blue" onclick="refreshDashboard(true)">Sincronizar Dados</button>
      <button class="btn btn-outline-blue" onclick="doLogout(); closeModal();">Sair do Sistema</button>
    </div>
  `);

  attachTenantUserForm();
  attachAdminPasswordForm();
}

async function gerarBackupEmpresa() {
  if (!hasAdminDashboard()) {
    showToast('Somente o admin da empresa pode gerar backup.', 'error');
    return;
  }

  try {
    const filename = `${currentUser?.slug || 'empresa'}-backup.zip`;
    await apiDownload('/empresa/backup', filename);
    showToast('Backup gerado com sucesso.', 'success');
  } catch (error) {
    console.error('Erro ao gerar backup:', error);
    showToast(error.message || 'Erro ao gerar backup.', 'error');
  }
}

function openModal(content) {
  const overlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  modalContent.innerHTML = content;
  overlay.classList.add('open');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const div = document.createElement('div');
  div.className = `toast-item ${type}`;
  div.textContent = message;
  toast.appendChild(div);

  setTimeout(() => {
    div.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => div.remove(), 300);
  }, 3000);
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

document.addEventListener('click', (event) => {
  const overlay = document.getElementById('modal-overlay');
  if (event.target === overlay) {
    closeModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal();
  }

  if (event.key === 'Enter' && document.getElementById('auth-screen').style.display !== 'none') {
    doLogin();
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  const savedToken = localStorage.getItem('vendas_token');
  const savedUser = localStorage.getItem('vendas_user');
  const adminContent = document.getElementById('admin-panel-content');

  if (adminContent) {
    defaultAdminPanelMarkup = adminContent.innerHTML;
  }

  renderPedidoTable();

  if (savedToken && savedUser) {
    authToken = savedToken;
    currentUser = JSON.parse(savedUser);
    await initApp();
  }
});

console.log('Sistema de Vendas carregado com sucesso.');

