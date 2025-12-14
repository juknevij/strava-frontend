import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, TrendingUp, MapPin, Clock, Award, Activity, RefreshCw, Trash2, Mountain, Flame, ChevronDown, LogOut } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Area, AreaChart, Legend
} from 'recharts';

const STRAVA_CLIENT_ID = '34209';
const REDIRECT_URI = window.location.origin;

// Color palette for charts
const COLORS = ['#FF6B35', '#F7C94B', '#45B7D1', '#96CEB4', '#9B59B6', '#3498DB', '#E74C3C', '#2ECC71'];
const GRADIENT_COLORS = {
  orange: ['#FF6B35', '#FF8C5A'],
  blue: ['#45B7D1', '#6DD5ED'],
  purple: ['#9B59B6', '#BD7BC9'],
  green: ['#2ECC71', '#58D68D'],
};

export default function StravaYearlySummary() {
  const [user, setUser] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState(null);
  const [cacheInfo, setCacheInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  const API_BASE = 'http://localhost:3001';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      exchangeToken(code);
    }
    const token = localStorage.getItem('strava_token');
    if (token) {
      fetchAthleteData(token);
    }
  }, []);

  useEffect(() => {
    if (activities.length > 0) {
      calculateSummary();
    }
  }, [activities, selectedYear]);

  const handleLogin = () => {

    const scope = 'read,activity:read_all';

    // 2. Ensure we use 'localhost' instead of '127.0.0.1' if that's what is in the browser,
    // because Strava settings typically whitelist 'localhost' explicitly.
    let redirectOrigin = window.location.origin;
    if (redirectOrigin.includes('127.0.0.1')) {
      redirectOrigin = redirectOrigin.replace('127.0.0.1', 'localhost');
    }

    const redirectUri = encodeURIComponent(redirectOrigin);
    // approval_prompt=force ensures the dialog is shown even if previously approved
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&approval_prompt=force`;

    console.log('Using Client ID:', STRAVA_CLIENT_ID);
    console.log('Redirecting to:', authUrl);

    window.location.href = authUrl;
  };

  const exchangeToken = async (code) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/exchange-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      if (!response.ok) throw new Error('Token exchange failed');
      const data = await response.json();
      localStorage.setItem('strava_token', data.access_token);
      setUser(data.athlete);
      fetchActivities(data.access_token);
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      console.error('Token exchange failed:', err);
    }
    setLoading(false);
  };

  const fetchAthleteData = async (token) => {
    try {
      const response = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setUser(data);
      await loadCachedActivities(data.id, token);
    } catch (err) {
      console.error('Failed to fetch athlete:', err);
      localStorage.removeItem('strava_token');
    }
  };

  const loadCachedActivities = async (athleteId, token) => {
    try {
      const response = await fetch(`${API_BASE}/api/activities/${athleteId}`);
      const cache = await response.json();
      if (cache.activities && cache.activities.length > 0) {
        setActivities(cache.activities);
        setCacheInfo({ lastUpdated: cache.lastUpdated, count: cache.activities.length });
      } else {
        await fetchActivities(token, athleteId);
      }
    } catch (err) {
      console.error('Failed to load cache:', err);
      await fetchActivities(token, athleteId);
    }
  };

  const saveActivitiesToCache = async (athleteId, activitiesList) => {
    try {
      const response = await fetch(`${API_BASE}/api/activities/${athleteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities: activitiesList })
      });
      const result = await response.json();
      setCacheInfo({ lastUpdated: result.lastUpdated, count: result.count });
    } catch (err) {
      console.error('Failed to save cache:', err);
    }
  };

  const fetchActivities = async (token, athleteId) => {
    setLoading(true);
    try {
      let allActivities = [];
      let page = 1;
      const perPage = 200;
      while (true) {
        const response = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const data = await response.json();
        if (data.length === 0) break;
        allActivities = [...allActivities, ...data];
        page++;
      }
      setActivities(allActivities);
      if (athleteId) await saveActivitiesToCache(athleteId, allActivities);
    } catch (err) {
      console.error('Failed to fetch activities:', err);
    }
    setLoading(false);
  };

  const handleRefreshFromStrava = async () => {
    const token = localStorage.getItem('strava_token');
    if (token && user) await fetchActivities(token, user.id);
  };

  const handleClearCache = async () => {
    if (!user) return;
    try {
      await fetch(`${API_BASE}/api/activities/${user.id}`, { method: 'DELETE' });
      setCacheInfo(null);
      setActivities([]);
      setSummary(null);
    } catch (err) {
      console.error('Failed to clear cache:', err);
    }
  };

  const calculateSummary = () => {
    const yearActivities = selectedYear === 'all'
      ? activities
      : activities.filter(a => new Date(a.start_date).getFullYear() === selectedYear);

    const stats = {
      total: yearActivities.length,
      distance: 0,
      time: 0,
      elevation: 0,
      byType: {},
      byMonth: {},
      yearActivities,
      topDistance: [],
      topElevation: []
    };

    yearActivities.forEach(activity => {
      stats.distance += activity.distance || 0;
      stats.time += activity.moving_time || 0;
      stats.elevation += activity.total_elevation_gain || 0;

      const type = activity.type || 'Other';
      if (!stats.byType[type]) {
        stats.byType[type] = { count: 0, distance: 0, time: 0 };
      }
      stats.byType[type].count++;
      stats.byType[type].distance += activity.distance || 0;
      stats.byType[type].time += activity.moving_time || 0;

      // Group by month
      const month = new Date(activity.start_date).getMonth();
      if (!stats.byMonth[month]) {
        stats.byMonth[month] = { count: 0, distance: 0, time: 0, elevation: 0 };
      }
      stats.byMonth[month].count++;
      stats.byMonth[month].distance += activity.distance || 0;
      stats.byMonth[month].time += activity.moving_time || 0;
      stats.byMonth[month].elevation += activity.total_elevation_gain || 0;
    });

    stats.topDistance = [...yearActivities]
      .sort((a, b) => (b.distance || 0) - (a.distance || 0))
      .slice(0, 10);

    stats.topElevation = [...yearActivities]
      .sort((a, b) => (b.total_elevation_gain || 0) - (a.total_elevation_gain || 0))
      .slice(0, 10);

    setSummary(stats);
  };

  const handleLogout = () => {
    localStorage.removeItem('strava_token');
    setUser(null);
    setActivities([]);
    setSummary(null);
    setCacheInfo(null);
  };

  const formatDistance = (meters) => (meters / 1000).toFixed(1);
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const availableYears = [...new Set(activities.map(a =>
    new Date(a.start_date).getFullYear()
  ))].sort((a, b) => b - a);

  // Chart data preparations
  const monthlyData = useMemo(() => {
    if (!summary) return [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months.map((name, idx) => ({
      name,
      activities: summary.byMonth[idx]?.count || 0,
      distance: Math.round((summary.byMonth[idx]?.distance || 0) / 1000),
      elevation: Math.round(summary.byMonth[idx]?.elevation || 0),
      time: Math.round((summary.byMonth[idx]?.time || 0) / 3600 * 10) / 10,
    }));
  }, [summary]);

  const activityTypeData = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.byType)
      .map(([name, data], idx) => ({
        name,
        value: data.count,
        distance: Math.round(data.distance / 1000),
        color: COLORS[idx % COLORS.length]
      }))
      .sort((a, b) => b.value - a.value);
  }, [summary]);

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: 'rgba(17, 24, 39, 0.95)',
          border: '1px solid rgba(255, 107, 53, 0.3)',
          borderRadius: '12px',
          padding: '12px 16px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
        }}>
          <p style={{ color: '#FF6B35', fontWeight: '600', marginBottom: '8px' }}>{label}</p>
          {payload.map((entry, idx) => (
            <p key={idx} style={{ color: entry.color || '#fff', fontSize: '14px' }}>
              {entry.name}: {entry.value} {entry.name === 'distance' ? 'km' : entry.name === 'time' ? 'hrs' : ''}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Login Screen
  if (!user) {
    let redirectOrigin = window.location.origin;
    if (redirectOrigin.includes('127.0.0.1')) {
      redirectOrigin = redirectOrigin.replace('127.0.0.1', 'localhost');
    }

    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(20px)',
          borderRadius: '32px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '60px 50px',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 32px 64px rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            boxShadow: '0 16px 32px rgba(255, 107, 53, 0.3)'
          }}>
            <Activity size={40} color="white" />
          </div>
          <h1 style={{
            fontSize: '32px',
            fontWeight: '700',
            background: 'linear-gradient(135deg, #fff, #a0a0a0)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '12px'
          }}>
            Strava Summary
          </h1>
          <p style={{
            color: 'rgba(255, 255, 255, 0.6)',
            fontSize: '16px',
            lineHeight: '1.6',
            marginBottom: '36px'
          }}>
            Connect your Strava account to visualize your yearly activity statistics with beautiful charts
          </p>
          <button
            onClick={handleLogin}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              fontWeight: '600',
              padding: '18px 32px',
              borderRadius: '16px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: '0 8px 24px rgba(255, 107, 53, 0.4)'
            }}
            onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
          >
            Connect with Strava
          </button>

          <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', fontSize: '12px', color: '#888', textAlign: 'left' }}>
            <p style={{ marginBottom: '4px' }}><strong>Debug Info:</strong></p>
            <p>Client ID: <span style={{ color: '#fff', fontFamily: 'monospace' }}>{STRAVA_CLIENT_ID}</span></p>
            <p>Redirecting to: <span style={{ color: '#fff', fontFamily: 'monospace' }}>{redirectOrigin}</span></p>
            <p style={{ marginTop: '8px', fontStyle: 'italic' }}>Ensure "Authorization Callback Domain" in Strava Settings is set to <span style={{ color: '#FF6B35' }}>localhost</span></p>
          </div>
        </div>
      </div>
    );
  }

  // Loading Screen
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '60px',
            height: '60px',
            border: '3px solid rgba(255, 107, 53, 0.2)',
            borderTop: '3px solid #FF6B35',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 24px'
          }} />
          <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '18px' }}>Loading your activities...</p>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Stat Card Component
  const StatCard = ({ icon: Icon, value, label, color, subvalue }) => (
    <div style={{
      background: 'rgba(255, 255, 255, 0.03)',
      backdropFilter: 'blur(10px)',
      borderRadius: '24px',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      padding: '28px',
      transition: 'all 0.3s ease',
      cursor: 'default'
    }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.borderColor = `${color}40`;
        e.currentTarget.style.boxShadow = `0 20px 40px ${color}20`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          background: `linear-gradient(135deg, ${color}, ${color}80)`,
          borderRadius: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 8px 20px ${color}40`
        }}>
          <Icon size={24} color="white" />
        </div>
      </div>
      <div style={{ fontSize: '36px', fontWeight: '700', color: 'white', marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', fontWeight: '500' }}>{label}</div>
      {subvalue && <div style={{ fontSize: '12px', color, marginTop: '8px', fontWeight: '500' }}>{subvalue}</div>}
    </div>
  );

  // Main Dashboard
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      color: 'white'
    }}>
      {/* Header */}
      <header style={{
        background: 'rgba(255, 255, 255, 0.02)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '20px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {user.profile && (
            <img
              src={user.profile}
              alt={user.firstname}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '14px',
                border: '2px solid rgba(255, 107, 53, 0.5)'
              }}
            />
          )}
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
              {user.firstname} {user.lastname}
            </h1>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
              {activities.length} total activities
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Year Selector */}
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Calendar size={18} color="#FF6B35" />
            <select
              value={selectedYear}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedYear(val === 'all' ? 'all' : Number(val));
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'white',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="all" style={{ background: '#1a1a2e' }}>All Time</option>
              {availableYears.map(year => (
                <option key={year} value={year} style={{ background: '#1a1a2e' }}>{year}</option>
              ))}
            </select>
          </div>

          {/* Cache Info & Actions */}
          <button
            onClick={handleRefreshFromStrava}
            disabled={loading}
            style={{
              background: 'rgba(69, 183, 209, 0.15)',
              border: '1px solid rgba(69, 183, 209, 0.3)',
              color: '#45B7D1',
              padding: '10px 16px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Sync
          </button>

          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#EF4444',
              padding: '10px 16px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {/* Cache Banner */}
      {cacheInfo && (
        <div style={{
          background: 'rgba(255, 107, 53, 0.1)',
          borderBottom: '1px solid rgba(255, 107, 53, 0.2)',
          padding: '12px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '14px'
        }}>
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>
            📦 Data cached: {new Date(cacheInfo.lastUpdated).toLocaleString()} • {cacheInfo.count} activities
          </span>
          <button
            onClick={handleClearCache}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Trash2 size={14} /> Clear cache
          </button>
        </div>
      )}

      {/* Main Content */}
      <main style={{ padding: '40px', maxWidth: '1400px', margin: '0 auto' }}>
        {summary && (
          <>
            {/* Stats Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '24px',
              marginBottom: '40px'
            }}>
              <StatCard
                icon={Activity}
                value={summary.total}
                label="Total Activities"
                color="#FF6B35"
                subvalue={selectedYear === 'all' ? 'All Time' : `${selectedYear} Year`}
              />
              <StatCard
                icon={MapPin}
                value={`${formatDistance(summary.distance)} km`}
                label="Total Distance"
                color="#45B7D1"
                subvalue={`Avg ${summary.total > 0 ? formatDistance(summary.distance / summary.total) : 0} km/activity`}
              />
              <StatCard
                icon={Clock}
                value={formatTime(summary.time)}
                label="Total Time"
                color="#9B59B6"
                subvalue={`${Math.round(summary.time / 3600)} hours active`}
              />
              <StatCard
                icon={Mountain}
                value={`${Math.round(summary.elevation).toLocaleString()} m`}
                label="Elevation Gain"
                color="#2ECC71"
                subvalue={`${(summary.elevation / 8848).toFixed(1)}x Everest`}
              />
            </div>

            {/* Charts Section */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
              gap: '24px',
              marginBottom: '40px'
            }}>
              {/* Monthly Activity Chart */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '28px'
              }}>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <TrendingUp size={20} color="#FF6B35" />
                  Monthly Activity Trend
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="colorActivities" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#FF6B35" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="activities"
                      stroke="#FF6B35"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#colorActivities)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Activity Types Pie Chart */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '28px'
              }}>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <Award size={20} color="#F7C94B" />
                  Activity Breakdown
                </h3>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <ResponsiveContainer width="60%" height={280}>
                    <PieChart>
                      <Pie
                        data={activityTypeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {activityTypeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {activityTypeData.slice(0, 5).map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '4px',
                          background: item.color
                        }} />
                        <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
                          {item.name}
                        </span>
                        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                          ({item.value})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Distance & Elevation Charts */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
              gap: '24px',
              marginBottom: '40px'
            }}>
              {/* Distance by Month */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '28px'
              }}>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <MapPin size={20} color="#45B7D1" />
                  Distance by Month (km)
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="distance" fill="#45B7D1" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Elevation by Month */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '28px'
              }}>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <Mountain size={20} color="#2ECC71" />
                  Elevation by Month (m)
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="elevation" fill="#2ECC71" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Longest Activity Highlight */}
            {/* Top Activities Tables */}
            {(summary.topDistance.length > 0 || summary.topElevation.length > 0) && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
                gap: '24px',
                marginBottom: '40px'
              }}>
                {/* Top Distance Table */}
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '24px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '28px'
                }}>
                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <Flame size={20} color="#FF6B35" />
                    Longest Activities
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ textAlign: 'left', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Name</th>
                          <th style={{ textAlign: 'right', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Date</th>
                          <th style={{ textAlign: 'right', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Distance</th>
                          <th style={{ textAlign: 'right', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Elevation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.topDistance.map((activity, i) => (
                          <tr key={activity.id} style={{ borderBottom: i < 9 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                            <td style={{ padding: '12px', fontWeight: '500', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <a
                                href={`https://www.strava.com/activities/${activity.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}
                                onMouseOver={(e) => e.target.style.color = '#FF6B35'}
                                onMouseOut={(e) => e.target.style.color = 'inherit'}
                              >
                                {activity.name}
                              </a>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>
                              {new Date(activity.start_date).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#45B7D1', fontWeight: '600' }}>
                              {formatDistance(activity.distance)} km
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>
                              {Math.round(activity.total_elevation_gain)} m
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top Elevation Table */}
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '24px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '28px'
                }}>
                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <Mountain size={20} color="#2ECC71" />
                    Highest Elevation Gain
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ textAlign: 'left', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Name</th>
                          <th style={{ textAlign: 'right', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Date</th>
                          <th style={{ textAlign: 'right', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Elevation</th>
                          <th style={{ textAlign: 'right', padding: '12px', color: 'rgba(255,255,255,0.5)' }}>Distance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.topElevation.map((activity, i) => (
                          <tr key={activity.id} style={{ borderBottom: i < 9 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                            <td style={{ padding: '12px', fontWeight: '500', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <a
                                href={`https://www.strava.com/activities/${activity.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}
                                onMouseOver={(e) => e.target.style.color = '#2ECC71'}
                                onMouseOut={(e) => e.target.style.color = 'inherit'}
                              >
                                {activity.name}
                              </a>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>
                              {new Date(activity.start_date).toLocaleDateString()}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: '#2ECC71', fontWeight: '600' }}>
                              {Math.round(activity.total_elevation_gain)} m
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>
                              {formatDistance(activity.distance)} km
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
