// Wardah UI Example Component
// This component demonstrates how to use the Wardah UI Design System

import React from 'react';
import { useWardahTheme } from '@/components/wardah-theme-provider';
import { 
  getGlassClasses, 
  getGradientTextClasses, 
  getFloatAnimationClasses,
  getGoogleGradients
} from '@/lib/wardah-ui-utils';

const WardahUIExample: React.FC = () => {
  const { theme } = useWardahTheme();
  const gradients = getGoogleGradients();

  return (
    <div className={`p-6 ${gradients.darkBackground} min-h-screen`}>
      <div className="max-w-4xl mx-auto">
        <h1 className={`text-4xl font-bold mb-8 text-center ${getGradientTextClasses()}`}>
          Wardah UI Design System
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Glass Card Example */}
          <div className={getGlassClasses()}>
            <div className="p-6">
              <h2 className={`text-2xl font-bold mb-4 ${getGradientTextClasses()}`}>
                Glassmorphism Card
              </h2>
              <p className="text-gray-300 mb-4">
                This is an example of a glassmorphism card with hover effects. 
                The card has a frosted glass appearance with a subtle border.
              </p>
              <button className={`px-4 py-2 rounded-lg ${gradients.primary} text-white font-medium hover:opacity-90 transition-opacity`}>
                Call to Action
              </button>
            </div>
          </div>
          
          {/* Animated Card Example */}
          <div className={`${getGlassClasses()} ${getFloatAnimationClasses()}`}>
            <div className="p-6">
              <h2 className={`text-2xl font-bold mb-4 ${getGradientTextClasses()}`}>
                Animated Card
              </h2>
              <p className="text-gray-300 mb-4">
                This card has a floating animation effect. 
                Hover over it to see the glassmorphism hover effect.
              </p>
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Gradient Examples */}
        <div className="mb-8">
          <h2 className={`text-3xl font-bold mb-6 text-center ${getGradientTextClasses()}`}>
            Gradient Examples
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`p-4 rounded-lg ${gradients.primary} text-white text-center`}>
              Primary Gradient
            </div>
            <div className={`p-4 rounded-lg ${gradients.extended} text-white text-center`}>
              Extended Gradient
            </div>
            <div className={`p-4 rounded-lg ${gradients.cardBackground} text-white text-center`}>
              Card Background
            </div>
          </div>
        </div>
        
        {/* Theme Values Display */}
        <div className={getGlassClasses()}>
          <div className="p-6">
            <h2 className={`text-2xl font-bold mb-4 ${getGradientTextClasses()}`}>
              Theme Values
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="font-bold mb-2">Colors</h3>
                <ul className="space-y-1">
                  <li>Blue: <span className="text-blue-400">{theme.colors.google.blue}</span></li>
                  <li>Red: <span className="text-red-400">{theme.colors.google.red}</span></li>
                  <li>Yellow: <span className="text-yellow-400">{theme.colors.google.yellow}</span></li>
                  <li>Green: <span className="text-green-400">{theme.colors.google.green}</span></li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold mb-2">Typography</h3>
                <ul className="space-y-1">
                  <li>Font Family: {theme.typography.fontFamily}</li>
                  <li>Base Size: {theme.typography.sizes.base}</li>
                  <li>Bold Weight: {theme.typography.weights.bold}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WardahUIExample;