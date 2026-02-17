import React, { useState } from 'react';
import { StudentLevel, TargetLanguage } from '../types';

interface LanguageSetupProps {
  onComplete: (language: TargetLanguage, level: StudentLevel) => void;
}

const LANGUAGES: TargetLanguage[] = ['English', 'French', 'German', 'Italian', 'Portuguese'];
const LEVELS: StudentLevel[] = ['Beginner (A1-A2)', 'Intermediate (B1-B2)', 'Advanced (C1-C2)'];

const LanguageSetup: React.FC<LanguageSetupProps> = ({ onComplete }) => {
  const [language, setLanguage] = useState<TargetLanguage>('English');
  const [level, setLevel] = useState<StudentLevel>('Beginner (A1-A2)');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete(language, level);
  };

  const OptionCard: React.FC<{ value: string; selectedValue: string; onClick: (value: any) => void }> = ({
    value,
    selectedValue,
    onClick,
  }) => (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`p-4 rounded-lg text-center transition-all duration-200 w-full md:w-auto flex-1 ${
        selectedValue === value ? 'bg-indigo-600 text-white shadow-lg scale-105' : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      {value}
    </button>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-800">
      <h1 className="text-4xl font-bold text-indigo-400 mb-2">Welcome to Miss Laura's Classroom!</h1>
      <p className="text-lg text-gray-300 mb-8">Set it up and start talking.</p>

      <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-8">
        <div>
          <label className="block text-xl font-semibold mb-4 text-gray-200">What language do you want to practice?</label>
          <div className="flex flex-col md:flex-row gap-4">
            {LANGUAGES.map((lang) => (
              <OptionCard key={lang} value={lang} selectedValue={language} onClick={setLanguage} />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xl font-semibold mb-4 text-gray-200">What is your approximate level?</label>
          <div className="flex flex-col md:flex-row gap-4">
            {LEVELS.map((lvl) => (
              <OptionCard key={lvl} value={lvl} selectedValue={level} onClick={setLevel} />
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-8 rounded-lg text-xl transition-transform duration-200 transform hover:scale-105"
        >
          Start Learning
        </button>
      </form>
    </div>
  );
};

export default LanguageSetup;
