import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Calendar,
  DollarSign,
  TrendingUp,
  Filter,
} from 'lucide-react';
import {
  getVehicles,
  getCostByVehicle,
  getCostByCategory,
  getMonthlyTrends,
  exportCsv,
  exportPdf,
} from '../api';
import { StatCardSkeleton, Skeleton } from './ui/LoadingSkeleton';
import { showSuccess, showError, showLoading, dismissToast } from './ui/Toast';
import { subDays, subMonths, subYears, format } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';

const CHART_COLORS = [
  '#1B4F72',
  '#2E86C1',
  '#3498DB',
  '#5DADE2',
  '#85C1E9',
  '#AED6F1',
  '#D4E6F1',
  '#154360',
  '#1A5276',
  '#1F618D',
];

const dateRanges = [
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Last 6 Months', value: '6m' },
  { label: 'Last Year', value: '1y' },
  { label: 'All Time', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

function getDateRange(range) {
  const now = new Date();
  switch (range) {
    case '30d':
      return { from: subDays(now, 30), to: now };
    case '6m':
      return { from: subMonths(now, 6), to: now };
    case '1y':
      return { from: subYears(now, 1), to: now };
    case 'all':
      return { from: null, to: null };
    default:
      return { from: null, to: null };
  }
}

export default function Reports() {
  const [vehicles, setVehicles] = useState([]);
  const [costByVehicle, setCostByVehicle] = useState([]);
  const [costByCategory, setCostByCategory] = useState([]);
  const [monthlyTrends, setMonthlyTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('1y');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('all');

  useEffect(() => {
    fetchVehicles();
  }, []);

  useEffect(() => {
    fetchReports();
  }, [dateRange, customFrom, customTo, selectedVehicle]);

  const fetchVehicles = async () => {
    try {
      const data = await getVehicles();
      const list = Array.isArray(data)
        ? data
        : data?.vehicles || data?.data || [];
      setVehicles(list);
    } catch {
      // ignore
    }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      let params = {};
      if (dateRange === 'custom') {
        if (customFrom) params.from = customFrom;
        if (customTo) params.to = customTo;
      } else if (dateRange !== 'all') {
        const { from, to } = getDateRange(dateRange);
        if (from) params.from = format(from, 'yyyy-MM-dd');
        if (to) params.to = format(to, 'yyyy-MM-dd');
      }
      if (selectedVehicle !== 'all') params.vehicleId = selectedVehicle;

      const [byVehicle, byCategory, trends] = await Promise.allSettled([
        getCostByVehicle(params),
        getCostByCategory(params),
        getMonthlyTrends(params),
      ]);

      if (byVehicle.status === 'fulfilled') {
        const d = byVehicle.value;
        setCostByVehicle(Array.isArray(d) ? d : d?.data || d?.costs || []);
      }
      if (byCategory.status === 'fulfilled') {
        const d = byCategory.value;
        setCostByCategory(Array.isArray(d) ? d : d?.data || d?.costs || []);
      }
      if (trends.status === 'fulfilled') {
        const d = trends.value;
        setMonthlyTrends(Array.isArray(d) ? d : d?.data || d?.trends || []);
      }
    } catch {
      showError('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (type) => {
    const toastId = showLoading(`Generating ${type.toUpperCase()}...`);
    try {
      let params = {};
      if (dateRange === 'custom') {
        if (customFrom) params.from = customFrom;
        if (customTo) params.to = customTo;
      } else if (dateRange !== 'all') {
        const { from, to } = getDateRange(dateRange);
        if (from) params.from = format(from, 'yyyy-MM-dd');
        if (to) params.to = format(to, 'yyyy-MM-dd');
      }
      if (selectedVehicle !== 'all') params.vehicleId = selectedVehicle;

      const blob = type === 'csv' ? await exportCsv(params) : await exportPdf(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vehicle-report.${type}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      dismissToast(toastId);
      showSuccess(`${type.toUpperCase()} exported!`);
    } catch {
      dismissToast(toastId);
      showError('Export failed');
    }
  };

  // Summary stats
  const totalSpend = useMemo(
    () => costByVehicle.reduce((sum, d) => sum + (d.total || d.cost || d.amount || 0), 0),
    [costByVehicle]
  );
  const totalCategories = costByCategory.length;
  const avgMonthly = useMemo(() => {
    if (monthlyTrends.length === 0) return 0;
    const total = monthlyTrends.reduce(
      (sum, d) => sum + (d.total || d.cost || d.amount || 0),
      0
    );
    return Math.round(total / monthlyTrends.length);
  }, [monthlyTrends]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                     dark:border-gray-800 shadow-lg p-3 text-sm">
        <p className="font-medium text-gray-900 dark:text-gray-50">{label}</p>
        {payload.map((entry, i) => (
          <p key={i} style={{ color: entry.color }} className="mt-1">
            {entry.name}: AED {Number(entry.value).toLocaleString()}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-700 dark:text-brand-400" />
            Reports
          </h1>
          <p className="page-subtitle">Analytics and cost breakdown</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport('csv')} className="btn-secondary text-sm">
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button onClick={() => handleExport('pdf')} className="btn-primary text-sm">
            <Download className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <div className="flex gap-1 flex-wrap">
              {dateRanges.map((range) => (
                <button
                  key={range.value}
                  onClick={() => setDateRange(range.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    dateRange === range.value
                      ? 'bg-brand-700 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={selectedVehicle}
              onChange={(e) => setSelectedVehicle(e.target.value)}
              className="select text-sm py-1.5 w-auto"
            >
              <option value="all">All Vehicles</option>
              {vehicles.map((v) => (
                <option key={v._id || v.id} value={v._id || v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Custom date inputs */}
        {dateRange === 'custom' && (
          <div className="flex gap-3 mt-3 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">From</label>
              <input
                type="date"
                className="input text-sm py-1.5"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">To</label>
              <input
                type="date"
                className="input text-sm py-1.5"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          [1, 2, 3].map((i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <div className="stat-card">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-50 dark:bg-violet-950/50 rounded-lg">
                  <DollarSign className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Total Spend
                  </p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
                    AED {totalSpend.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-50 dark:bg-brand-950/50 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Avg. Monthly
                  </p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
                    AED {avgMonthly.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Categories
                  </p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
                    {totalCategories}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by Vehicle - Bar Chart */}
        <div className="card p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Cost by Vehicle
          </h3>
          {loading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : costByVehicle.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-gray-400">
              No data available
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByVehicle}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="total"
                    name="Total Cost"
                    fill="#1B4F72"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Cost by Category - Pie Chart */}
        <div className="card p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Cost by Category
          </h3>
          {loading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : costByCategory.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-gray-400">
              No data available
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={costByCategory}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="total"
                    nameKey="name"
                    label={({ name, percent }) =>
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                    labelLine={false}
                  >
                    {costByCategory.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => `AED ${Number(value).toLocaleString()}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Legend */}
          {costByCategory.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {costByCategory.map((cat, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                    }}
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    {cat.name || cat.category}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Monthly Trends - Line Chart */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Monthly Spend Trend
        </h3>
        {loading ? (
          <Skeleton className="h-72 w-full rounded-lg" />
        ) : monthlyTrends.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-sm text-gray-400">
            No data available
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Spend"
                  stroke="#1B4F72"
                  strokeWidth={2}
                  dot={{ fill: '#1B4F72', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
