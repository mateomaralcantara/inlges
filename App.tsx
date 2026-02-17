import React, { useState } from 'react';
import LanguageSetup from './components/LanguageSetup';
import ConversationView from './components/ConversationView';
import { StudentLevel, TargetLanguage } from './types';

const App: React.FC = () => {
  const [setupComplete, setSetupComplete] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>('English');
  const [studentLevel, setStudentLevel] = useState<StudentLevel>('Beginner (A1-A2)');

  const handleSetupComplete = (language: TargetLanguage, level: StudentLevel) => {
    setTargetLanguage(language);
    setStudentLevel(level);
    setSetupComplete(true);
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans flex items-center justify-center">
      <div className="w-full max-w-4xl h-full md:h-[90vh] md:max-h-[800px] bg-gray-800 shadow-2xl rounded-lg flex flex-col">
        {!setupComplete ? (
          <LanguageSetup onComplete={handleSetupComplete} />
        ) : (
          <ConversationView targetLanguage={targetLanguage} studentLevel={studentLevel} />
        )}
      </div>
    </div>
  );
};

export default App;
