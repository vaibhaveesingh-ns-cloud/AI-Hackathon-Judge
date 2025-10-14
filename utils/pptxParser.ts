import JSZip from 'jszip';

// A simple XML parser to extract text content from within all <a:t> tags in a slide's XML.
const extractTextFromXml = (xmlString: string): string => {
  const textNodes = xmlString.match(/<a:t>.*?<\/a:t>/g) || [];
  return textNodes
    .map(node => node.replace(/<.+?>/g, '')) // Strip all XML tags to get raw text
    .join(' ');
};

export const parsePptx = async (file: File): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        if (!event.target?.result) {
          return reject(new Error('Failed to read file.'));
        }
        const zip = await JSZip.loadAsync(event.target.result as ArrayBuffer);
        const slideFiles = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));

        // Sort slides numerically (e.g., slide1.xml, slide2.xml, ... slide10.xml)
        slideFiles.sort((a, b) => {
          const numA = parseInt(a.match(/(\d+)\.xml$/)?.[1] || '0');
          const numB = parseInt(b.match(/(\d+)\.xml$/)?.[1] || '0');
          return numA - numB;
        });
        
        const slidePromises = slideFiles.map(fileName => zip.file(fileName)!.async('string'));
        const slideXmls = await Promise.all(slidePromises);
        const slideTexts = slideXmls.map(extractTextFromXml);
        
        resolve(slideTexts);
      } catch (error) {
        console.error("Error parsing PPTX file:", error)
        reject(new Error("The file appears to be corrupted or is not a valid .pptx file."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};
