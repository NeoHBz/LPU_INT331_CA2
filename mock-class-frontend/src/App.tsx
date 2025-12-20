import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Classroom from './pages/Classroom';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/class" element={<Classroom />} />
      </Routes>
    </Router>
  );
}

export default App;
