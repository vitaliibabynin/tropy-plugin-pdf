'use strict'

const { join, extname } = require('path')
const PDFDocument = require('pdfkit')
const { createWriteStream, promises: fsPromises } = require('fs')
const { shell } = require('electron')

class PDFOriginalPlugin {
  constructor(options, context) {
    this.options = {
      ...PDFOriginalPlugin.defaults,
      ...options
    }

    this.logger = context.logger
    this.dialog = context.dialog.save
  }

  async generatePDF(data, outputPath) {
    try {
      // Check if all photos are from a single PDF file
      const photos = data['@graph'].reduce((acc, item) => {
        if (item.photo) {
          acc.push(...item.photo)
        }
        return acc
      }, [])

      // If we have photos and they're all from the same PDF
      if (photos.length > 0 && photos.every(p => p.mimetype === 'application/pdf')) {
        const firstPhoto = photos[0]
        // Check if all photos are from the same PDF file
        if (photos.every(p => p.path === firstPhoto.path)) {
          try {
            // Just copy the original PDF file
            await fsPromises.copyFile(firstPhoto.path, outputPath)
            return
          } catch (err) {
            this.logger.error(`Failed to copy PDF file: ${err.message}`)
            throw err
          }
        }
      }

      // If not all photos are from the same PDF, proceed with normal PDF generation
      const doc = new PDFDocument({ 
        autoFirstPage: false,
        size: 'A4',
        font: 'Helvetica'
      })
      
      const writeStream = createWriteStream(outputPath)
      doc.pipe(writeStream)

      // Process all photos in the item
      for (let item of data['@graph']) {
        if (!item.photo) continue

        for (let photo of item.photo) {
          if (photo.protocol !== 'file') continue
          
          // Skip PDF files and unsupported formats
          if (photo.mimetype === 'application/pdf' || 
              !['image/jpeg', 'image/png', 'image/gif'].includes(photo.mimetype)) {
            this.logger.info(`Skipping unsupported file format: ${photo.mimetype}`)
            continue
          }

          try {
            // Check if file exists and is readable
            await fsPromises.access(photo.path)
            
            // Rest of the existing page creation code...
            doc.addPage({
              size: 'A4',
              layout: 'portrait'
            })

            const originalWidth = photo.width
            const originalHeight = photo.height

            // ... rest of the existing dimension calculations ...

            doc.save()
            doc.translate(x + (finalWidth / 2), y + (finalHeight / 2))

            switch (photo.orientation) {
              case 3:
                doc.rotate(180)
                break
              case 6:
                doc.rotate(-90)
                break
              case 8:
                doc.rotate(90)
                break
              case 1:
              default:
                break
            }

            doc.image(photo.path, -finalWidth/2, -finalHeight/2, {
              width: finalWidth,
              height: finalHeight
            })

            doc.restore()
          } catch (err) {
            this.logger.error(`Failed to process image ${photo.path}: ${err.message}`)
            continue // Skip this photo but continue with others
          }
        }
      }

      doc.end()
      
      return new Promise((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })

    } catch (err) {
      this.logger.error(`PDF generation failed: ${err.message}`)
      throw err
    }
  }

  async export(data) {
    let { pdfFile, filters } = this.options

    // Get the first item's title to use as default filename
    const defaultTitle = data['@graph'][0]?.title || 'export'
    const defaultPdfFile = `${defaultTitle}.pdf`

    if (!pdfFile || this.options.prompt) {
      pdfFile = await this.dialog({ 
        defaultPath: defaultPdfFile,
        filters 
      })
    }

    if (!pdfFile) return

    // Ensure file has .pdf extension
    if (extname(pdfFile) !== '.pdf') {
      throw new Error(`not a pdf file: ${pdfFile}`)
    }

    // Generate the PDF
    await this.generatePDF(data, pdfFile)

    // Open the PDF file directly instead of showing in folder
    await shell.openPath(pdfFile)
  }
}

PDFOriginalPlugin.defaults = {
  filters: [
    {
      name: 'PDF Files',
      extensions: ['pdf']
    }
  ],
  prompt: false
}

module.exports = PDFOriginalPlugin






