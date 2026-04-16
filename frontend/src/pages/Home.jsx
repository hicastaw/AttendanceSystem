import { Link } from 'react-router-dom';
import { ScanFace, BookUser, ChevronRight, Shield, Zap, BarChart3 } from 'lucide-react';

export default function Home() {
  const features = [
    { icon: <Shield className="w-6 h-6" />, title: 'Nhận diện chính xác', desc: 'Model AI YuNet + MBF độ chính xác > 85%, kháng nhiễu ảnh mờ.' },
    { icon: <Zap className="w-6 h-6" />, title: 'Realtime', desc: 'Quét liên tục qua camera, ghi nhận điểm danh tức thì.' },
    { icon: <BarChart3 className="w-6 h-6" />, title: 'Thống kê đầy đủ', desc: 'Phân loại đúng giờ, đi muộn, vắng mặt, lưu lịch sử toàn bộ.' },
  ];

  return (
    <main className="flex-grow">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary-container to-red-600 text-white py-24 px-8">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}
        />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur px-4 py-2 rounded-full text-sm font-semibold mb-8">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Hệ thống đang hoạt động — PTIT 2025
          </div>
          <h1 className="text-5xl md:text-6xl font-black mb-6 leading-tight">
            Điểm danh thông minh<br />bằng khuôn mặt
          </h1>
          <p className="text-xl text-white/80 mb-12 max-w-2xl mx-auto leading-relaxed">
            Tự động hóa điểm danh sinh viên với AI nhận diện khuôn mặt.
            Chính xác, nhanh chóng, không gian lận.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/profile"
              className="flex items-center justify-center gap-2 bg-white text-primary-container font-bold px-8 py-4 rounded-xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all"
            >
              <BookUser className="w-5 h-5" />
              Cập nhật Profile
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link
              to="/scan"
              className="flex items-center justify-center gap-2 bg-white/20 backdrop-blur border-2 border-white/40 font-bold px-8 py-4 rounded-xl hover:bg-white/30 transition-all"
            >
              <ScanFace className="w-5 h-5" />
              Bắt đầu điểm danh
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-8 max-w-5xl mx-auto">
        <h2 className="text-3xl font-black text-center mb-12 text-on-surface">
          Tại sao dùng hệ thống này?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f, i) => (
            <div key={i} className="bg-white border border-outline-variant/30 rounded-2xl p-8 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all">
              <div className="w-12 h-12 bg-red-100 text-primary-container rounded-xl flex items-center justify-center mb-4">
                {f.icon}
              </div>
              <h3 className="text-lg font-bold mb-2">{f.title}</h3>
              <p className="text-secondary text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
