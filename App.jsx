import React, { useState, useMemo, useEffect } from 'react';
import { 
  Home, 
  CreditCard, 
  Users, 
  User,
  Settings, 
  Plus, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  DollarSign, 
  Activity,
  Calendar,
  Tag,
  X,
  PieChart as PieChartIcon,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc } from 'firebase/firestore';

// --- CONFIGURACIÓN NUBE (Para sincronizar entre teléfonos) ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const initialRates = {
  bcv: 36.25,
  binance: 39.80
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [rates, setRates] = useState(initialRates);
  const [isLoadingRates, setIsLoadingRates] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [sharedExpenses, setSharedExpenses] = useState([]);
  const [user, setUser] = useState(null);
  
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('tx-frederick'); // 'tx-frederick', 'tx-dougleisy' o 'shared'

  const [isEditingRates, setIsEditingRates] = useState(false);
  const [tempRates, setTempRates] = useState(rates);

  // Obtener Tasas
  const fetchRates = async () => {
    setIsLoadingRates(true);
    try {
      const [resBcv, resParalelo] = await Promise.all([
        fetch('https://ve.dolarapi.com/v1/dolares/oficial'),
        fetch('https://ve.dolarapi.com/v1/dolares/paralelo')
      ]);
      if (!resBcv.ok || !resParalelo.ok) throw new Error("Error en API");
      const dataBcv = await resBcv.json();
      const dataParalelo = await resParalelo.json();
      const newRates = {
        bcv: dataBcv.promedio || dataBcv.precio || rates.bcv,
        binance: dataParalelo.promedio || dataParalelo.precio || rates.binance
      };
      setRates(newRates);
      setTempRates(newRates);
    } catch (error) {
      console.error("Error tasas:", error);
    } finally {
      setIsLoadingRates(false);
    }
  };

  useEffect(() => { fetchRates(); }, []);

  // Inicializar Auth
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Escuchar Base de Datos (USAMOS RUTA PÚBLICA PARA COMPARTIR ENTRE SUS TELÉFONOS)
  useEffect(() => {
    if (!user) return;

    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    const unsubsTx = onSnapshot(txRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTransactions(data);
    }, (error) => console.error(error));

    const shRef = collection(db, 'artifacts', appId, 'public', 'data', 'sharedExpenses');
    const unsubsSh = onSnapshot(shRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSharedExpenses(data);
    }, (error) => console.error(error));

    return () => { unsubsTx(); unsubsSh(); };
  }, [user]);

  const filteredTransactions = useMemo(() => transactions.filter(t => t.date.startsWith(selectedMonth)), [transactions, selectedMonth]);
  const filteredShared = useMemo(() => sharedExpenses.filter(e => e.date.startsWith(selectedMonth)), [sharedExpenses, selectedMonth]);

  // Cálculos Frederick
  const fredTx = useMemo(() => filteredTransactions.filter(t => t.owner === 'frederick'), [filteredTransactions]);
  const fredStats = useMemo(() => calcStats(fredTx, rates.bcv), [fredTx, rates.bcv]);

  // Cálculos Dougleisy
  const dougTx = useMemo(() => filteredTransactions.filter(t => t.owner === 'dougleisy'), [filteredTransactions]);
  const dougStats = useMemo(() => calcStats(dougTx, rates.bcv), [dougTx, rates.bcv]);

  // Cálculos Pareja (Aportes Proporcionales)
  const sharedStats = useMemo(() => {
    let paidByFred = 0, paidByDoug = 0;
    filteredShared.forEach(e => {
      if (e.paidBy === 'frederick') paidByFred += e.amountUSD;
      if (e.paidBy === 'dougleisy') paidByDoug += e.amountUSD;
    });
    const total = paidByFred + paidByDoug;
    
    // Ingresos individuales del mes
    const fredIncome = fredStats.totalIncomeUSD;
    const dougIncome = dougStats.totalIncomeUSD;

    // Porcentaje del propio ingreso que cada uno aportó a la casa (Esfuerzo)
    const fredEffort = fredIncome > 0 ? (paidByFred / fredIncome) * 100 : 0;
    const dougEffort = dougIncome > 0 ? (paidByDoug / dougIncome) * 100 : 0;

    // Porcentaje que representa su aporte sobre el total de los gastos de la casa
    const fredShare = total > 0 ? (paidByFred / total) * 100 : 0;
    const dougShare = total > 0 ? (paidByDoug / total) * 100 : 0;

    return { total, paidByFred, paidByDoug, fredIncome, dougIncome, fredEffort, dougEffort, fredShare, dougShare };
  }, [filteredShared, fredStats.totalIncomeUSD, dougStats.totalIncomeUSD]);

  function calcStats(txs, bcvRate) {
    let totalIncomeUSD = 0, totalExpenseUSD = 0;
    const categories = {};
    txs.forEach(t => {
      if (t.type === 'income') totalIncomeUSD += t.amountUSD;
      else {
        totalExpenseUSD += t.amountUSD;
        categories[t.category] = (categories[t.category] || 0) + t.amountUSD;
      }
    });
    const sortedCategories = Object.entries(categories).sort(([, a], [, b]) => b - a).map(([name, amount]) => ({ name, amount }));
    return {
      balanceUSD: totalIncomeUSD - totalExpenseUSD,
      balanceVES: (totalIncomeUSD - totalExpenseUSD) * bcvRate,
      totalIncomeUSD, totalExpenseUSD, sortedCategories
    };
  }

  const formatUSD = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  const formatVES = (amount) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES' }).format(amount).replace('VES', 'Bs');

  const handleSeedData = async () => {
    if (!user) return;
    try {
      const dummyTx = [
        { owner: 'frederick', type: 'income', amountUSD: 150, amountVES: 150 * rates.bcv, currency: 'USD', rateType: 'bcv', rateUsed: rates.bcv, category: 'Pago Gringoland', date: `${selectedMonth}-01`, description: 'Quincena Fred' },
        { owner: 'frederick', type: 'expense', amountUSD: 25, amountVES: 25 * rates.binance, currency: 'USD', rateType: 'binance', rateUsed: rates.binance, category: 'Transporte', date: `${selectedMonth}-05`, description: 'Gasolina' },
        { owner: 'dougleisy', type: 'income', amountUSD: 120, amountVES: 120 * rates.bcv, currency: 'USD', rateType: 'bcv', rateUsed: rates.bcv, category: 'Pago Desvan', date: `${selectedMonth}-02`, description: 'Honorarios Doug' }
      ];
      const dummyShared = [
        { paidBy: 'frederick', amountUSD: 40, amountVES: 40 * rates.binance, currency: 'USD', rateUsed: rates.binance, description: 'Cena de Aniversario', date: `${selectedMonth}-12`, category: 'Salidas' },
        { paidBy: 'dougleisy', amountUSD: 60, amountVES: 60 * rates.bcv, currency: 'VES', rateUsed: rates.bcv, description: 'Compra Supermercado', date: `${selectedMonth}-15`, category: 'Alimentos/Mercado' }
      ];
      for (const tx of dummyTx) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'transactions'), tx);
      for (const sh of dummyShared) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'sharedExpenses'), sh);
    } catch (err) { console.error(err); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-800">
      
      {/* Sidebar */}
      <nav className="bg-emerald-950 text-white w-full md:w-64 flex-shrink-0 md:min-h-screen flex flex-col shadow-xl z-10">
        <div className="p-6 flex items-center gap-3 border-b border-emerald-900">
          <div className="bg-emerald-500 p-2 rounded-lg"><Activity className="w-6 h-6 text-white" /></div>
          <h1 className="text-xl font-bold tracking-tight">Finanzas<span className="text-emerald-400">VE</span></h1>
        </div>
        
        <div className="flex-1 px-4 py-4 space-y-2 overflow-y-auto hidden md:block">
          <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Home />} label="Resumen" color="emerald" />
          <NavItem active={activeTab === 'tx-frederick'} onClick={() => setActiveTab('tx-frederick')} icon={<User />} label="Mov. Frederick" color="emerald" />
          <NavItem active={activeTab === 'tx-dougleisy'} onClick={() => setActiveTab('tx-dougleisy')} icon={<User />} label="Mov. Dougleisy" color="violet" />
          <NavItem active={activeTab === 'shared'} onClick={() => setActiveTab('shared')} icon={<Users />} label="Gastos Pareja" color="blue" />
        </div>

        {/* Mobile Nav */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-emerald-950 text-white flex justify-around p-2 pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50">
          <MobileNavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Home className="w-5 h-5" />} label="Resumen" color="emerald" />
          <MobileNavItem active={activeTab === 'tx-frederick'} onClick={() => setActiveTab('tx-frederick')} icon={<User className="w-5 h-5" />} label="Frederick" color="emerald" />
          <MobileNavItem active={activeTab === 'tx-dougleisy'} onClick={() => setActiveTab('tx-dougleisy')} icon={<User className="w-5 h-5" />} label="Dougleisy" color="violet" />
          <MobileNavItem active={activeTab === 'shared'} onClick={() => setActiveTab('shared')} icon={<Users className="w-5 h-5" />} label="Pareja" color="blue" />
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white shadow-sm px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 z-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              {activeTab === 'dashboard' && 'Resumen Global'}
              {activeTab === 'tx-frederick' && 'Cuentas de Frederick'}
              {activeTab === 'tx-dougleisy' && 'Cuentas de Dougleisy'}
              {activeTab === 'shared' && 'Cuentas Compartidas'}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <input type="month" className="text-sm font-bold border border-slate-200 rounded-lg p-1.5 bg-slate-50 text-slate-600 outline-none focus:border-emerald-500 shadow-sm" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-4 bg-slate-100 p-2 rounded-xl border border-slate-200">
            {isEditingRates ? (
              <div className="flex items-center gap-3">
                <div className="flex flex-col"><span className="text-xs text-slate-500 font-semibold">BCV</span><input type="number" step="0.01" className="w-20 text-sm p-1 rounded" value={tempRates.bcv} onChange={e => setTempRates({...tempRates, bcv: parseFloat(e.target.value)})} /></div>
                <div className="flex flex-col"><span className="text-xs text-slate-500 font-semibold">Paralelo</span><input type="number" step="0.01" className="w-20 text-sm p-1 rounded" value={tempRates.binance} onChange={e => setTempRates({...tempRates, binance: parseFloat(e.target.value)})} /></div>
                <button onClick={() => {setRates(tempRates); setIsEditingRates(false);}} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium">Guardar</button>
              </div>
            ) : (
              <>
                <div className="text-right">
                  <div className="flex items-center gap-2 text-sm"><span className="font-semibold">BCV:</span>{isLoadingRates ? <span className="animate-pulse">...</span> : <span className="text-emerald-700 font-bold">{rates.bcv} Bs</span>}</div>
                  <div className="flex items-center gap-2 text-sm"><span className="font-semibold">Paralelo:</span>{isLoadingRates ? <span className="animate-pulse">...</span> : <span className="text-emerald-700 font-bold">{rates.binance} Bs</span>}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={fetchRates} disabled={isLoadingRates} className="p-2 text-slate-400 bg-white rounded-lg shadow-sm border border-slate-200 hover:text-emerald-600"><RefreshCw className={`w-5 h-5 ${isLoadingRates ? 'animate-spin' : ''}`} /></button>
                  <button onClick={() => setIsEditingRates(true)} className="p-2 text-slate-400 bg-white rounded-lg shadow-sm border border-slate-200 hover:text-emerald-600"><Settings className="w-5 h-5" /></button>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          
          {/* VISTA: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 max-w-6xl mx-auto">
              {/* Tarjetas de Balance */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-2xl p-6 text-white shadow-lg">
                  <div className="flex items-center justify-between mb-4"><h3 className="font-medium text-emerald-100">Disp. Frederick</h3><User className="w-5 h-5 opacity-50" /></div>
                  <p className="text-3xl font-bold mb-1">{formatUSD(fredStats.balanceUSD)}</p>
                  <p className="text-emerald-200 text-sm">≈ {formatVES(fredStats.balanceVES)} <span className="text-xs">(BCV)</span></p>
                </div>
                <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-6 text-white shadow-lg">
                  <div className="flex items-center justify-between mb-4"><h3 className="font-medium text-violet-100">Disp. Dougleisy</h3><User className="w-5 h-5 opacity-50" /></div>
                  <p className="text-3xl font-bold mb-1">{formatUSD(dougStats.balanceUSD)}</p>
                  <p className="text-violet-200 text-sm">≈ {formatVES(dougStats.balanceVES)} <span className="text-xs">(BCV)</span></p>
                </div>
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center text-center">
                  <p className="text-sm text-slate-500 font-semibold mb-1">Total Gastos Pareja</p>
                  <p className="text-3xl font-bold text-blue-600 mb-1">{formatUSD(sharedStats.total)}</p>
                  <p className="text-xs text-slate-400">Ver detalles para aportes</p>
                </div>
              </div>

              {/* Gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryCard title="Gastos Frederick" stats={fredStats} color="emerald" onSeed={handleSeedData} />
                <CategoryCard title="Gastos Dougleisy" stats={dougStats} color="violet" onSeed={handleSeedData} />
              </div>

              {/* Nuevo Panel: Análisis de Aportes Proporcionales */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm mt-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    Análisis de Aportes al Hogar
                  </h3>
                  <button onClick={() => setActiveTab('shared')} className="text-sm text-blue-600 font-medium hover:underline">Ver detalles</button>
                </div>
                
                <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
                  <p className="text-sm text-slate-500 text-center mb-5 font-medium">¿Cuánto de su propio ingreso aportó cada uno este mes?</p>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-bold text-emerald-700">Frederick aportó {formatUSD(sharedStats.paidByFred)}</span>
                        <span className="text-emerald-700 font-bold">{sharedStats.fredEffort.toFixed(1)}% de su ingreso</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-3">
                        <div className="bg-emerald-500 h-3 rounded-full transition-all" style={{ width: `${Math.min(sharedStats.fredEffort, 100)}%` }}></div>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 text-right">de {formatUSD(sharedStats.fredIncome)} generados</p>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-bold text-violet-700">Dougleisy aportó {formatUSD(sharedStats.paidByDoug)}</span>
                        <span className="text-violet-700 font-bold">{sharedStats.dougEffort.toFixed(1)}% de su ingreso</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-3">
                        <div className="bg-violet-500 h-3 rounded-full transition-all" style={{ width: `${Math.min(sharedStats.dougEffort, 100)}%` }}></div>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 text-right">de {formatUSD(sharedStats.dougIncome)} generados</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VISTA: FREDERICK */}
          {activeTab === 'tx-frederick' && (
            <TransactionView 
              title="Movimientos Frederick" 
              color="emerald"
              transactions={fredTx} 
              formatUSD={formatUSD} 
              formatVES={formatVES}
              onAdd={() => { setModalType('tx-frederick'); setIsModalOpen(true); }}
              onDelete={(id) => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', id))}
              onSeed={handleSeedData}
            />
          )}

          {/* VISTA: DOUGLEISY */}
          {activeTab === 'tx-dougleisy' && (
            <TransactionView 
              title="Movimientos Dougleisy" 
              color="violet"
              transactions={dougTx} 
              formatUSD={formatUSD} 
              formatVES={formatVES}
              onAdd={() => { setModalType('tx-dougleisy'); setIsModalOpen(true); }}
              onDelete={(id) => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', id))}
              onSeed={handleSeedData}
            />
          )}

          {/* VISTA: PAREJA */}
          {activeTab === 'shared' && (
            <div className="max-w-5xl mx-auto">
               <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-800">Gastos Compartidos</h3>
                <button onClick={() => { setModalType('shared'); setIsModalOpen(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2 shadow-sm">
                  <Plus className="w-5 h-5" /><span className="hidden sm:inline">Añadir Gasto</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="text-center border-r border-slate-100">
                  <p className="text-sm text-emerald-600 font-bold mb-1">Aporte Fred</p>
                  <p className="text-xl font-bold text-slate-800">{formatUSD(sharedStats.paidByFred)}</p>
                  <p className="text-xs text-slate-500 mt-1 font-medium">{sharedStats.fredShare.toFixed(0)}% del total</p>
                </div>
                <div className="text-center border-r border-slate-100">
                  <p className="text-sm text-slate-500 font-semibold mb-1">Total Gastado</p>
                  <p className="text-2xl font-bold text-blue-600">{formatUSD(sharedStats.total)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-violet-600 font-bold mb-1">Aporte Doug</p>
                  <p className="text-xl font-bold text-slate-800">{formatUSD(sharedStats.paidByDoug)}</p>
                  <p className="text-xs text-slate-500 mt-1 font-medium">{sharedStats.dougShare.toFixed(0)}% del total</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {filteredShared.length === 0 ? <div className="p-10 text-center text-slate-400 flex flex-col items-center gap-3"><p>No hay gastos registrados.</p><button onClick={handleSeedData} className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm">Cargar datos prueba</button></div> : (
                  <div className="divide-y divide-slate-100">
                    {filteredShared.sort((a,b) => new Date(b.date) - new Date(a.date)).map(exp => (
                      <div key={exp.id} className="p-4 sm:p-5 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-full ${exp.paidBy === 'frederick' ? 'bg-emerald-100 text-emerald-600' : 'bg-violet-100 text-violet-600'}`}><Users className="w-6 h-6" /></div>
                          <div>
                            <p className="font-bold">{exp.description}</p>
                            <p className="text-xs text-slate-500 mt-1">Por: <span className="font-semibold">{exp.paidBy === 'frederick' ? 'Frederick' : 'Dougleisy'}</span> • {exp.date}</p>
                          </div>
                        </div>
                        <div className="text-right flex gap-3 items-center">
                          <div><p className="font-bold text-lg">{formatUSD(exp.amountUSD)}</p><p className="text-xs text-slate-400">{formatVES(exp.amountVES)}</p></div>
                          <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sharedExpenses', exp.id))} className="p-2 text-slate-300 hover:text-rose-500"><Trash2 className="w-5 h-5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </main>

      {isModalOpen && (
        <TransactionModal 
          type={modalType}
          rates={rates}
          onClose={() => setIsModalOpen(false)}
          onSave={async (data, syncOther) => {
            if (!user) return;
            try {
              // Enviar a Google Script (Intacto)
              fetch('https://script.google.com/macros/s/AKfycbywkGOByUIHpK4gDkvWzC3O2CjI0dbzIMQPOk5pMQt-FGM-eRXbgU2JM4-0UiZgXEN1jw/exec', {
                method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoria: data.category, descripcion: data.description, monto: data.amountUSD })
              }).catch(err => console.error(err));

              const isIndividual = data.owner !== undefined;
              
              if (isIndividual) {
                await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'transactions'), data);
                if (syncOther && data.type === 'expense') {
                  await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'sharedExpenses'), {
                    amountUSD: data.amountUSD, amountVES: data.amountVES, currency: data.currency, rateType: data.rateType, rateUsed: data.rateUsed, description: data.description, date: data.date, category: data.category,
                    paidBy: data.owner
                  });
                }
              } else {
                await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'sharedExpenses'), data);
                if (syncOther) {
                  await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'transactions'), {
                    amountUSD: data.amountUSD, amountVES: data.amountVES, currency: data.currency, rateType: data.rateType, rateUsed: data.rateUsed, description: data.description, date: data.date, category: data.category,
                    owner: data.paidBy, type: 'expense'
                  });
                }
              }
              setIsModalOpen(false);
            } catch (err) { console.error("Error nube:", err); }
          }}
        />
      )}
    </div>
  );
}

// --- COMPONENTES AUXILIARES DE VISTA ---
function NavItem({ icon, label, active, onClick, color }) {
  const colors = {
    emerald: 'text-emerald-400 bg-emerald-800/80',
    violet: 'text-violet-400 bg-emerald-800/80',
    blue: 'text-blue-400 bg-emerald-800/80',
  };
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${active ? `${colors[color]} font-semibold` : 'text-emerald-100 hover:bg-emerald-800/40'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function MobileNavItem({ icon, label, active, onClick, color }) {
  const colors = { emerald: 'text-emerald-400', violet: 'text-violet-400', blue: 'text-blue-400' };
  return (
    <button onClick={onClick} className={`flex flex-col items-center w-full ${active ? colors[color] : 'text-emerald-100/60'}`}>
      <div className="mb-1">{icon}</div><span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function CategoryCard({ title, stats, color, onSeed }) {
  const bgColors = { emerald: 'bg-emerald-500', violet: 'bg-violet-500' };
  const textColors = { emerald: 'text-emerald-600', violet: 'text-violet-600' };
  
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
      <h3 className={`font-bold text-lg flex items-center gap-2 mb-6 ${textColors[color]}`}><PieChartIcon className="w-5 h-5" /> {title}</h3>
      {stats.sortedCategories.length > 0 ? (
        <div className="space-y-4">
          {stats.sortedCategories.map((cat, idx) => {
            const percentage = ((cat.amount / stats.totalExpenseUSD) * 100).toFixed(0);
            return (
              <div key={idx}>
                <div className="flex justify-between text-sm mb-1"><span className="font-medium">{cat.name}</span><span className="text-slate-500">{formatUSD(cat.amount)} ({percentage}%)</span></div>
                <div className="w-full bg-slate-100 rounded-full h-2.5"><div className={`${bgColors[color]} h-2.5 rounded-full`} style={{ width: `${percentage}%` }}></div></div>
              </div>
            )
          })}
        </div>
      ) : <div className="text-center text-slate-400 py-6"><p>Sin gastos.</p><button onClick={onSeed} className="mt-3 text-sm underline">Cargar prueba</button></div>}
    </div>
  );
  function formatUSD(a) { return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(a); }
}

function TransactionView({ title, color, transactions, formatUSD, formatVES, onAdd, onDelete, onSeed }) {
  const btnColor = color === 'emerald' ? 'bg-emerald-600' : 'bg-violet-600';
  const iconBgInc = color === 'emerald' ? 'bg-emerald-100 text-emerald-600' : 'bg-violet-100 text-violet-600';
  const textInc = color === 'emerald' ? 'text-emerald-600' : 'text-violet-600';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        <button onClick={onAdd} className={`${btnColor} text-white px-4 py-2 rounded-xl flex items-center gap-2 shadow-sm`}><Plus className="w-5 h-5" /><span className="hidden sm:inline">Nuevo</span></button>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {transactions.length === 0 ? <div className="p-10 text-center text-slate-400"><p>No tienes transacciones.</p><button onClick={onSeed} className="mt-3 underline">Cargar prueba</button></div> : (
          <div className="divide-y divide-slate-100">
            {transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).map(tx => (
              <div key={tx.id} className="p-4 sm:p-5 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${tx.type === 'income' ? iconBgInc : 'bg-rose-100 text-rose-600'}`}>
                    {tx.type === 'income' ? <ArrowUpCircle /> : <ArrowDownCircle />}
                  </div>
                  <div>
                    <p className="font-bold">{tx.description}</p>
                    <div className="flex gap-2 text-xs text-slate-500 mt-1"><span className="bg-slate-100 px-2 py-0.5 rounded-md">{tx.category}</span><span>•</span><span>{tx.date}</span></div>
                  </div>
                </div>
                <div className="text-right flex gap-3 items-center">
                  <div>
                    <p className={`font-bold text-lg ${tx.type === 'income' ? textInc : ''}`}>{tx.type === 'income' ? '+' : '-'}{formatUSD(tx.amountUSD)}</p>
                    <p className="text-xs text-slate-400">{formatVES(tx.amountVES)} (Tasa: {tx.rateUsed})</p>
                  </div>
                  <button onClick={() => onDelete(tx.id)} className="p-2 text-slate-300 hover:text-rose-500"><Trash2 className="w-5 h-5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- MODAL UNIFICADO ---
function TransactionModal({ type, rates, onClose, onSave }) {
  const isIndividual = type.startsWith('tx-');
  const defaultOwner = type === 'tx-frederick' ? 'frederick' : 'dougleisy';
  const isFred = defaultOwner === 'frederick';
  
  const expenseCategories = ['Alimentos', 'Transporte', 'Servicios', 'Salidas/Ocio', 'Salud', 'Otros'];
  const fredIncomeCategories = ['Pago Gringoland', 'Pago Rubifactory', 'Pago Minimal Studio', 'Otros'];
  const dougIncomeCategories = ['Pago Desvan', 'Propina', 'Otras'];
  const currentIncomeCategories = isFred ? fredIncomeCategories : dougIncomeCategories;
  const sharedCategories = ['Alimentos/Mercado', 'Servicios', 'Salidas', 'Otros'];

  const [txType, setTxType] = useState('expense'); 
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [rateType, setRateType] = useState('bcv'); 
  const [customRate, setCustomRate] = useState('');
  const [category, setCategory] = useState(isIndividual ? expenseCategories[0] : sharedCategories[0]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paidBy, setPaidBy] = useState('frederick'); 
  const [syncOther, setSyncOther] = useState(false); 

  const effectiveRate = customRate ? parseFloat(customRate) : rates[rateType];
  const amountNum = parseFloat(amountInput) || 0;
  const amountUSD = currency === 'USD' ? amountNum : amountNum / effectiveRate;
  const amountVES = currency === 'VES' ? amountNum : amountNum * effectiveRate;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!amountNum || !description) return;
    const baseData = { amountUSD, amountVES, currency, rateType: customRate ? 'custom' : rateType, rateUsed: effectiveRate, description, date };
    if (isIndividual) onSave({ ...baseData, type: txType, category, owner: defaultOwner }, syncOther);
    else onSave({ ...baseData, paidBy, category }, syncOther);
  };

  const headerColor = isIndividual ? (txType === 'income' ? (isFred ? 'bg-emerald-600' : 'bg-violet-600') : 'bg-slate-800') : 'bg-blue-600';

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-lg flex flex-col max-h-[90vh] shadow-2xl">
        
        <div className={`p-5 text-white flex justify-between items-center rounded-t-3xl ${headerColor}`}>
          <h2 className="text-xl font-bold">{isIndividual ? (txType === 'income' ? 'Registrar Ingreso' : 'Registrar Gasto') : 'Gasto Compartido'}</h2>
          <button onClick={onClose}><X /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <form id="tx-form" onSubmit={handleSubmit} className="space-y-5">
            {isIndividual && (
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button type="button" onClick={() => {setTxType('expense'); setCategory(expenseCategories[0]);}} className={`flex-1 py-2 text-sm font-bold rounded-lg ${txType === 'expense' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>Gasto</button>
                <button type="button" onClick={() => {setTxType('income'); setCategory(currentIncomeCategories[0]);}} className={`flex-1 py-2 text-sm font-bold rounded-lg ${txType === 'income' ? (isFred ? 'bg-white text-emerald-600' : 'bg-white text-violet-600') : 'text-slate-500'}`}>Ingreso</button>
              </div>
            )}

            {!isIndividual && (
              <div className="space-y-2">
                <label className="text-sm font-semibold">¿Quién pagó?</label>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setPaidBy('frederick')} className={`flex-1 py-3 border-2 rounded-xl font-bold ${paidBy === 'frederick' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : ''}`}>Frederick</button>
                  <button type="button" onClick={() => setPaidBy('dougleisy')} className={`flex-1 py-3 border-2 rounded-xl font-bold ${paidBy === 'dougleisy' ? 'border-violet-600 bg-violet-50 text-violet-700' : ''}`}>Dougleisy</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1"><label className="text-sm font-semibold">Monto</label><input type="number" step="0.01" required className="w-full bg-slate-50 border p-3 rounded-xl text-lg font-bold outline-none" value={amountInput} onChange={e => setAmountInput(e.target.value)} /></div>
              <div className="space-y-1"><label className="text-sm font-semibold">Moneda</label><select className="w-full bg-slate-50 border p-3 rounded-xl font-bold outline-none" value={currency} onChange={e => setCurrency(e.target.value)}><option value="USD">USD ($)</option><option value="VES">Bs</option></select></div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
              <div className="flex justify-between items-center"><label className="text-sm font-semibold">Tasa</label><span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-bold">1 USD = {effectiveRate} Bs</span></div>
              <div className="flex gap-2">
                <button type="button" onClick={() => {setRateType('bcv'); setCustomRate('');}} className={`flex-1 py-2 text-sm rounded border font-medium ${rateType === 'bcv' && !customRate ? 'bg-white border-emerald-500 text-emerald-700' : ''}`}>BCV</button>
                <button type="button" onClick={() => {setRateType('binance'); setCustomRate('');}} className={`flex-1 py-2 text-sm rounded border font-medium ${rateType === 'binance' && !customRate ? 'bg-white border-emerald-500 text-emerald-700' : ''}`}>Paralelo</button>
              </div>
              <input type="number" step="0.01" placeholder="Tasa manual (opcional)" className="w-full text-sm border p-2 rounded outline-none" value={customRate} onChange={e => setCustomRate(e.target.value)} />
            </div>

            {amountInput && <div className="text-center p-3 bg-blue-50 text-blue-800 rounded-xl border border-blue-100"><p className="text-sm">Equivalente:</p><p className="text-lg font-bold">{currency === 'USD' ? `${amountVES.toFixed(2)} Bs` : `$${amountUSD.toFixed(2)} USD`}</p></div>}

            <div className="space-y-4">
              <div className="space-y-1"><label className="text-sm font-semibold">Descripción</label><input type="text" required className="w-full bg-slate-50 border p-3 rounded-xl text-sm" value={description} onChange={e => setDescription(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><label className="text-sm font-semibold">Categoría</label>
                  <select className="w-full bg-slate-50 border p-3 rounded-xl text-sm" value={category} onChange={e => setCategory(e.target.value)}>
                    {isIndividual ? (txType === 'income' ? currentIncomeCategories.map(c => <option key={c}>{c}</option>) : expenseCategories.map(c => <option key={c}>{c}</option>)) : sharedCategories.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><label className="text-sm font-semibold">Fecha</label><input type="date" required className="w-full bg-slate-50 border p-3 rounded-xl text-sm" value={date} onChange={e => setDate(e.target.value)} /></div>
              </div>

              {isIndividual && txType === 'expense' && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl"><input type="checkbox" id="s1" checked={syncOther} onChange={e => setSyncOther(e.target.checked)} className="w-5 h-5" /><label htmlFor="s1" className="text-sm text-blue-800 font-semibold cursor-pointer">Agregar también a Gastos de Pareja (Por mí)</label></div>
              )}
              {!isIndividual && (
                <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl"><input type="checkbox" id="s2" checked={syncOther} onChange={e => setSyncOther(e.target.checked)} className="w-5 h-5" /><label htmlFor="s2" className="text-sm text-emerald-800 font-semibold cursor-pointer">Reflejar en el resumen individual de quien pagó</label></div>
              )}
            </div>
          </form>
        </div>
        <div className="p-5 border-t bg-slate-50 flex justify-end gap-3 rounded-b-3xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold">Cancelar</button>
          <button type="submit" form="tx-form" className={`px-6 py-2.5 rounded-xl text-white font-bold ${isIndividual ? (isFred ? 'bg-emerald-600' : 'bg-violet-600') : 'bg-blue-600'}`}>Guardar</button>
        </div>
      </div>
    </div>
  );
}